import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';
import crypto from 'crypto';

// ─── Helper: generate a unique 8-char uppercase alphanumeric tournament code ──
function generateTournamentCode() {
  // 6 random bytes → 12 hex chars → take first 8 and uppercase
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
}

async function uniqueTournamentCode() {
  let attempts = 0;
  while (attempts < 10) {
    const code = generateTournamentCode();
    const existing = await prisma.tournament.findUnique({ where: { tournamentCode: code } });
    if (!existing) return code;
    attempts++;
  }
  // Fallback: extremely unlikely, but safe
  return generateTournamentCode() + Date.now().toString(36).toUpperCase().slice(-4);
}

// ─── Helper to parse embedded tournament config ──
function parseTournamentConfig(description) {
  let fieldSize = 11;
  let substitutionMode = 'normal';
  let cleanDescription = description || '';

  if (description) {
    const match = description.match(/<!--config:(.*?)-->/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.fieldSize) fieldSize = Number(parsed.fieldSize);
        if (parsed.substitutionMode) substitutionMode = parsed.substitutionMode;
        cleanDescription = description.replace(/<!--config:.*?-->/g, '').trim();
      } catch (e) {
        // ignore
      }
    }
  }

  return {
    fieldSize: (!isNaN(fieldSize) && fieldSize > 0) ? fieldSize : 11,
    substitutionMode: substitutionMode === 'rolling' ? 'rolling' : 'normal',
    cleanDescription
  };
}

function buildTournamentDescription(description, fieldSize, substitutionMode) {
  const cleanDesc = (description || '').replace(/<!--config:.*?-->/g, '').trim();
  const config = {
    fieldSize: (!isNaN(Number(fieldSize)) && Number(fieldSize) > 0) ? Number(fieldSize) : 11,
    substitutionMode: substitutionMode === 'rolling' ? 'rolling' : 'normal'
  };
  return `${cleanDesc} <!--config:${JSON.stringify(config)}-->`.trim();
}

// CREATE a new tournament
export const createTournament = async (req, res) => {
  try {
    const organizerId = req.user.id;

    // Quick security check: Is this user actually an organizer or admin?
    const user = await prisma.profile.findUnique({ where: { id: organizerId } });
    if (!user || (user.role !== 'organizer' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only organizers or admins can create tournaments.' });
    }

    const { name, slug, description, format, location, startDate, endDate, maxTeams, entryFee, fieldSize, substitutionMode } = req.body;

    if (!name || !slug || !location) {
      return res.status(400).json({ error: 'Name, slug, and location are required.' });
    }

    // Coerce and validate numeric fields before handing to Prisma.
    // Prisma expects Int for maxTeams and Decimal for entryFee.
    const parsedMaxTeams = maxTeams !== undefined ? Number(maxTeams) : 16;
    const parsedEntryFee = entryFee !== undefined ? Number(entryFee) : 0;

    if (!Number.isFinite(parsedMaxTeams) || parsedMaxTeams < 2) {
      return res.status(400).json({ error: 'maxTeams must be a valid integer of at least 2.' });
    }
    if (!Number.isFinite(parsedEntryFee) || parsedEntryFee < 0) {
      return res.status(400).json({ error: 'entryFee must be a valid non-negative number.' });
    }

    // Embed fieldSize and substitutionMode into description
    const finalDescription = buildTournamentDescription(description, fieldSize, substitutionMode);

    // Generate a unique tournament code for the organizer to share
    const tournamentCode = await uniqueTournamentCode();

    const newTournament = await prisma.tournament.create({
      data: {
        name,
        slug,
        description: finalDescription,
        format,
        location,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        maxTeams: parsedMaxTeams,
        entryFee: parsedEntryFee,
        organizerId,
        tournamentCode
      }
    });

    // Parse config for response
    const config = parseTournamentConfig(newTournament.description);
    const tournamentResponse = {
      ...newTournament,
      fieldSize: config.fieldSize,
      substitutionMode: config.substitutionMode,
    };

    // Notify the organizer that their tournament was created
    await createNotification({
      userId: organizerId,
      title: 'Tournament Created!',
      message: `Your tournament "${newTournament.name}" has been created. Share the join code "${tournamentCode}" with team captains/managers.`,
      type: 'success',
      link: `/tournaments/${newTournament.slug || newTournament.id}`
    });

    res.status(201).json({ message: 'Tournament created!', tournament: tournamentResponse });
  } catch (err) {
    console.error('Error creating tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ all tournaments
// tournamentCode is stripped from the response unless the caller is the organizer or admin.
export const getAllTournaments = async (req, res) => {
  try {
    const callerId = req.user?.id ?? null;
    const callerProfile = callerId
      ? await prisma.profile.findUnique({ where: { id: callerId }, select: { role: true } })
      : null;
    const isAdmin = callerProfile?.role === 'admin';

    const { organizerId, mine } = req.query;
    let whereClause = {};

    if (mine === 'true' && callerId) {
      if (!isAdmin) {
        whereClause.organizerId = callerId;
      }
    } else if (organizerId) {
      whereClause.organizerId = organizerId;
    }

    const rawTournaments = await prisma.tournament.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            teams: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const tournaments = rawTournaments.map(t => {
      const { _count, tournamentCode, ...rest } = t;
      const isOrganizer = callerId && t.organizerId === callerId;
      const config = parseTournamentConfig(t.description);
      return {
        ...rest,
        fieldSize: config.fieldSize,
        substitutionMode: config.substitutionMode,
        registeredTeamsCount: _count?.teams ?? 0,
        // Only expose the code to the organizer of this tournament or an admin
        ...(isOrganizer || isAdmin ? { tournamentCode } : {})
      };
    });

    res.status(200).json({ tournaments });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// GET Organizer Dashboard Data (Scoped to current authenticated organizer)
export const getOrganizerDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check user profile and role
    const user = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true, fullName: true, email: true }
    });

    if (!user || (user.role !== 'organizer' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Access denied. Organizer or admin role required.' });
    }

    const isAdmin = user.role === 'admin';

    // 1. Tournaments:
    // If admin: all tournaments; If organizer: strictly where organizerId === userId
    const tournamentWhere = isAdmin ? {} : { organizerId: userId };

    const tournaments = await prisma.tournament.findMany({
      where: tournamentWhere,
      include: {
        _count: {
          select: {
            teams: true,
            matches: true
          }
        },
        organizer: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const tournamentIds = tournaments.map(t => t.id);

    // 2. Registered Teams:
    // Only teams registered in this organizer's tournaments (or all if admin)
    const teams = (tournamentIds.length > 0 || isAdmin)
      ? await prisma.team.findMany({
          where: isAdmin ? {} : { tournamentId: { in: tournamentIds } },
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
                organizerId: true
              }
            },
            _count: {
              select: {
                members: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        })
      : [];

    const teamIds = teams.map(t => t.id);

    // 3. Total Players:
    // Only players/team members belonging to that organizer's tournaments/teams
    const totalPlayersCount = (tournamentIds.length > 0 || isAdmin) && (teamIds.length > 0 || isAdmin)
      ? await prisma.teamMember.count({
          where: isAdmin
            ? {}
            : {
                OR: [
                  { teamId: { in: teamIds } },
                  { team: { tournamentId: { in: tournamentIds } } }
                ]
              }
        })
      : 0;

    // 4. Matches (all & upcoming):
    // Only matches from that organizer's tournaments
    const matches = (tournamentIds.length > 0 || isAdmin)
      ? await prisma.match.findMany({
          where: isAdmin ? {} : { tournamentId: { in: tournamentIds } },
          include: {
            tournament: {
              select: {
                id: true,
                name: true
              }
            },
            homeTeam: {
              select: {
                id: true,
                name: true,
                shortName: true,
                logoUrl: true
              }
            },
            awayTeam: {
              select: {
                id: true,
                name: true,
                shortName: true,
                logoUrl: true
              }
            },
            winnerTeam: {
              select: {
                id: true,
                name: true,
                shortName: true,
                logoUrl: true
              }
            }
          },
          orderBy: { matchDate: 'asc' }
        })
      : [];

    const upcomingMatchesCount = matches.filter(
      m => m.status !== 'Completed' && m.status !== 'completed' && m.status !== 'fulltime'
    ).length;

    // 5. Dynamic Recent Activity:
    // Activities exclusively for this organizer's tournaments, teams, players, and matches
    const activities = [];

    // Tournament Created
    tournaments.forEach(t => {
      if (t.createdAt) {
        activities.push({
          id: `tournament-created-${t.id}`,
          type: 'tournament_created',
          action: `New tournament '${t.name}' was created.`,
          timestamp: t.createdAt,
          color: 'bg-green-600',
        });
      }
    });

    // Team Registered
    teams.forEach(team => {
      if (team.createdAt) {
        const tournamentName = team.tournament?.name || tournaments.find(t => t.id === team.tournamentId)?.name;
        activities.push({
          id: `team-registered-${team.id}`,
          type: 'team_registered',
          action: tournamentName
            ? `Team '${team.name}' registered for ${tournamentName}.`
            : `Team '${team.name}' registered.`,
          timestamp: team.createdAt,
          color: 'bg-emerald-600',
        });
      }
    });

    // Tournament Completed
    tournaments.forEach(t => {
      const tMatches = matches.filter(m => m.tournamentId === t.id);
      const isMarkedCompleted = t.status === 'completed';
      const allMatchesFinished = tMatches.length > 0 && tMatches.every(m => m.status === 'completed' || m.status === 'fulltime');

      if (isMarkedCompleted || allMatchesFinished) {
        let winnerName = null;
        let completionTime = t.updatedAt || t.createdAt;

        // Knockout / Hybrid: find Final match
        const finalMatch = tMatches.find(m => m.roundName && m.roundName.toLowerCase().trim() === 'final');
        if (finalMatch && (finalMatch.status === 'completed' || finalMatch.status === 'fulltime')) {
          winnerName = finalMatch.winnerTeam?.name ||
            (finalMatch.winnerTeamId && (finalMatch.homeTeam?.id === finalMatch.winnerTeamId ? finalMatch.homeTeam?.name : finalMatch.awayTeam?.name)) ||
            (finalMatch.homeScore > finalMatch.awayScore ? finalMatch.homeTeam?.name : (finalMatch.awayScore > finalMatch.homeScore ? finalMatch.awayTeam?.name : null));
          completionTime = finalMatch.updatedAt || finalMatch.matchDate || completionTime;
        }

        // League: calculate standings if no final match
        if (!winnerName && tMatches.length > 0) {
          const teamScores = {};
          tMatches.filter(m => m.status === 'completed' || m.status === 'fulltime').forEach(m => {
            const hId = m.homeTeamId;
            const aId = m.awayTeamId;
            const hName = m.homeTeam?.name || 'Team';
            const aName = m.awayTeam?.name || 'Team';
            if (hId) {
              if (!teamScores[hId]) teamScores[hId] = { name: hName, pts: 0, gd: 0, gf: 0 };
              const hScore = m.homeScore ?? 0;
              const aScore = m.awayScore ?? 0;
              teamScores[hId].gf += hScore;
              teamScores[hId].gd += (hScore - aScore);
              if (hScore > aScore) teamScores[hId].pts += 3;
              else if (hScore === aScore) teamScores[hId].pts += 1;
            }
            if (aId) {
              if (!teamScores[aId]) teamScores[aId] = { name: aName, pts: 0, gd: 0, gf: 0 };
              const hScore = m.homeScore ?? 0;
              const aScore = m.awayScore ?? 0;
              teamScores[aId].gf += aScore;
              teamScores[aId].gd += (aScore - hScore);
              if (aScore > hScore) teamScores[aId].pts += 3;
              else if (aScore === hScore) teamScores[aId].pts += 1;
            }
          });
          const sorted = Object.values(teamScores).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
          if (sorted.length > 0) {
            winnerName = sorted[0].name;
          }
        }

        if (isMarkedCompleted || winnerName) {
          activities.push({
            id: `tournament-completed-${t.id}`,
            type: 'tournament_completed',
            action: winnerName
              ? `Tournament '${t.name}' completed. Winner: ${winnerName}`
              : `Tournament '${t.name}' completed.`,
            timestamp: completionTime,
            color: 'bg-green-600',
          });
        }
      }
    });

    const sortedActivities = activities
      .filter(a => a.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 3);

    const formattedTournaments = tournaments.map(t => {
      const { _count, tournamentCode, ...rest } = t;
      const config = parseTournamentConfig(t.description);
      return {
        ...rest,
        fieldSize: config.fieldSize,
        substitutionMode: config.substitutionMode,
        registeredTeamsCount: _count?.teams ?? 0,
        tournamentCode
      };
    });

    return res.status(200).json({
      stats: {
        tournaments: formattedTournaments.length,
        teams: teams.length,
        players: totalPlayersCount,
        upcomingMatches: upcomingMatchesCount
      },
      tournaments: formattedTournaments,
      teams,
      matches,
      recentActivities: sortedActivities
    });
  } catch (err) {
    console.error('Error fetching organizer dashboard data:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ a single tournament by slug or ID (Public)
export const getTournamentBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const callerId = req.user?.id ?? null;
    const callerProfile = callerId
      ? await prisma.profile.findUnique({ where: { id: callerId }, select: { role: true } })
      : null;
    const isAdmin = callerProfile?.role === 'admin';

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(slug);

    const rawTournament = await prisma.tournament.findFirst({
      where: isUuid
        ? { OR: [{ id: slug }, { slug }] }
        : { slug },
      include: {
        organizer: {
          select: {
            fullName: true,
            email: true
          }
        },
        _count: {
          select: {
            teams: true
          }
        }
      }
    });

    if (!rawTournament) return res.status(404).json({ error: 'Tournament not found.' });

    const { _count, tournamentCode, ...rest } = rawTournament;
    const isOrganizer = callerId && rawTournament.organizerId === callerId;
    const config = parseTournamentConfig(rawTournament.description);

    const tournament = {
      ...rest,
      fieldSize: config.fieldSize,
      substitutionMode: config.substitutionMode,
      registeredTeamsCount: _count?.teams ?? 0,
      // Only expose code to organizer or admin
      ...(isOrganizer || isAdmin ? { tournamentCode } : {})
    };

    res.status(200).json({ tournament });
  } catch (err) {
    console.error('Error fetching tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// UPDATE a tournament
export const updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    const tournament = await prisma.tournament.findUnique({ where: { id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    // Only the organizer (or an admin) can update
    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update this tournament.' });
    }

    // Coerce and validate numeric fields before handing to Prisma.
    const parsedMaxTeams = updateData.maxTeams !== undefined ? Number(updateData.maxTeams) : undefined;
    const parsedEntryFee = updateData.entryFee !== undefined ? Number(updateData.entryFee) : undefined;

    if (parsedMaxTeams !== undefined && (!Number.isFinite(parsedMaxTeams) || parsedMaxTeams < 2)) {
      return res.status(400).json({ error: 'maxTeams must be a valid integer of at least 2.' });
    }
    if (parsedEntryFee !== undefined && (!Number.isFinite(parsedEntryFee) || parsedEntryFee < 0)) {
      return res.status(400).json({ error: 'entryFee must be a valid non-negative number.' });
    }

    let finalDescription = updateData.description;
    if (updateData.fieldSize !== undefined || updateData.substitutionMode !== undefined || updateData.description !== undefined) {
      const existingConfig = parseTournamentConfig(tournament.description);
      const targetFieldSize = updateData.fieldSize !== undefined ? updateData.fieldSize : existingConfig.fieldSize;
      const targetSubMode = updateData.substitutionMode !== undefined ? updateData.substitutionMode : existingConfig.substitutionMode;
      const targetDesc = updateData.description !== undefined ? updateData.description : existingConfig.cleanDescription;
      finalDescription = buildTournamentDescription(targetDesc, targetFieldSize, targetSubMode);
    }

    const updatedTournament = await prisma.tournament.update({
      where: { id },
      data: {
        name: updateData.name,
        slug: updateData.slug,
        description: finalDescription,
        format: updateData.format,
        location: updateData.location,
        startDate: updateData.startDate
          ? new Date(updateData.startDate)
          : undefined,
        endDate: updateData.endDate
          ? new Date(updateData.endDate)
          : undefined,
        maxTeams: parsedMaxTeams,
        entryFee: parsedEntryFee
      }
    });

    const config = parseTournamentConfig(updatedTournament.description);
    const tournamentResponse = {
      ...updatedTournament,
      fieldSize: config.fieldSize,
      substitutionMode: config.substitutionMode,
    };

    res.status(200).json({ message: 'Tournament updated!', tournament: tournamentResponse });
  } catch (err) {
    console.error('Error updating tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE a tournament
export const deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const tournament = await prisma.tournament.findUnique({ where: { id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can delete this tournament.' });
    }

    await prisma.tournament.delete({ where: { id } });

    res.status(200).json({ message: 'Tournament deleted successfully.' });
  } catch (err) {
    console.error('Error deleting tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
