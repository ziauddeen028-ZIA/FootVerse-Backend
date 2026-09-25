import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { advanceKnockoutWinner } from './knockoutController.js';
import { createNotification } from './notificationController.js';

// ─── Helper: Generate 8-char unique alphanumeric Match Code ──────────────────
function generateMatchCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "8F2B1C9D"
}

// CREATE (Schedule) a new match (Supports Tournament Match or Quick Match)
export const scheduleMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tournamentId, homeTeamId, awayTeamId, matchDate, roundName, venue, status, matchCode: customCode } = req.body;

    const matchCode = customCode || generateMatchCode();

    if (tournamentId) {
      // Verify the user is the organizer of this tournament (or an admin)
      const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
      if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

      const user = await prisma.profile.findUnique({ where: { id: userId } });
      if (tournament.organizerId !== userId && user.role !== 'admin') {
        return res.status(403).json({ error: 'Only the organizer can schedule tournament matches.' });
      }
    }

    const newMatch = await prisma.match.create({
      data: {
        tournamentId: tournamentId || null,
        homeTeamId: homeTeamId || null,
        awayTeamId: awayTeamId || null,
        matchDate: matchDate ? new Date(matchDate) : new Date(),
        roundName: roundName || (tournamentId ? 'Group Stage' : 'Quick Match'),
        venue: venue || (tournamentId ? null : 'Local Pitch'),
        status: status || 'scheduled',
        refereeName: matchCode // Store matchCode in refereeName for persistent quick-lookup
      },
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
        }
      }
    });

    res.status(201).json({
      message: tournamentId ? 'Match scheduled!' : 'Quick Match created!',
      match: { ...newMatch, matchCode }
    });
  } catch (err) {
    console.error('Error scheduling match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── Helper to extract or ensure matchCode ────────────────────────────────────
function getMatchCodeFromMatch(m) {
  if (m?.refereeName && m.refereeName.length >= 6 && !m.refereeName.includes(' ') && /^[A-Z0-9_-]+$/i.test(m.refereeName)) {
    return m.refereeName.toUpperCase();
  }
  return m?.id ? m.id.replace(/-/g, '').slice(0, 8).toUpperCase() : 'FOOTMATCH';
}

// READ all matches
export const getAllMatches = async (req, res) => {
  try {
    const callerId = req.user?.id ?? null;
    const callerProfile = callerId
      ? await prisma.profile.findUnique({ where: { id: callerId }, select: { role: true } })
      : null;
    const isAdmin = callerProfile?.role === 'admin';

    const { tournamentId, organizerId, mine, isQuickMatch } = req.query;
    let whereClause = {};

    if (isQuickMatch === 'true') {
      whereClause.tournamentId = null;
    } else if (tournamentId) {
      whereClause.tournamentId = tournamentId;
    }

    if (mine === 'true' && callerId) {
      if (!isAdmin) {
        if (isQuickMatch === 'true') {
          whereClause.OR = [
            { homeTeam: { managerId: callerId } },
            { awayTeam: { managerId: callerId } },
            { homeTeam: { members: { some: { playerId: callerId } } } },
            { awayTeam: { members: { some: { playerId: callerId } } } }
          ];
        } else {
          whereClause.tournament = { organizerId: callerId };
        }
      }
    } else if (organizerId) {
      whereClause.tournament = { organizerId };
    }

    const rawMatches = await prisma.match.findMany({
      where: whereClause,
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
      orderBy: {
        matchDate: "asc"
      }
    });

    const matches = rawMatches.map(m => ({
      ...m,
      matchCode: getMatchCodeFromMatch(m)
    }));

    res.status(200).json({ matches });
  } catch (err) {
    console.error('Error fetching all matches:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ a single match by ID
export const getMatchById = async (req, res) => {
  try {
    const { id } = req.params;

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        tournament: {
          select: { id: true, name: true, format: true }
        },
        homeTeam: {
          select: { id: true, name: true, shortName: true, logoUrl: true }
        },
        awayTeam: {
          select: { id: true, name: true, shortName: true, logoUrl: true }
        },
        winnerTeam: {
          select: { id: true, name: true, shortName: true, logoUrl: true }
        }
      }
    });

    if (!match) return res.status(404).json({ error: 'Match not found.' });

    res.status(200).json({
      match: {
        ...match,
        matchCode: getMatchCodeFromMatch(match)
      }
    });
  } catch (err) {
    console.error('Error fetching match by ID:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// LOOKUP match by 8-character Match Code (Quick Match or code)
export const getMatchByCode = async (req, res) => {
  try {
    const { code } = req.params;
    if (!code) return res.status(400).json({ error: 'Match code is required.' });

    const normalizedCode = String(code).trim().toUpperCase().replace(/^(QM-|MCH-)/i, '');

    let match = await prisma.match.findFirst({
      where: {
        OR: [
          { refereeName: normalizedCode },
          { refereeName: `QM-${normalizedCode}` },
          { refereeName: `MCH-${normalizedCode}` }
        ]
      },
      include: {
        tournament: { select: { id: true, name: true, format: true } },
        homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        winnerTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
      }
    });

    if (!match && normalizedCode.length >= 8) {
      const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedCode);
      if (isFullUuid) {
        match = await prisma.match.findUnique({
          where: { id: normalizedCode },
          include: {
            tournament: { select: { id: true, name: true, format: true } },
            homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            winnerTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
          }
        });
      }
    }

    if (!match) {
      return res.status(404).json({ error: 'Match not found with the provided code.' });
    }

    res.status(200).json({
      match: {
        ...match,
        matchCode: getMatchCodeFromMatch(match)
      }
    });
  } catch (err) {
    console.error('Error fetching match by code:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// JOIN a Quick Match by code (Opposing team connects)
export const joinQuickMatchByCode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code, teamId } = req.body;

    if (!code || !teamId) {
      return res.status(400).json({ error: 'Match code and teamId are required.' });
    }

    const normalizedCode = String(code).trim().toUpperCase().replace(/^(QM-|MCH-)/i, '');

    let match = await prisma.match.findFirst({
      where: {
        OR: [
          { refereeName: normalizedCode },
          { refereeName: `QM-${normalizedCode}` },
          { refereeName: `MCH-${normalizedCode}` }
        ]
      },
      include: {
        homeTeam: { select: { id: true, name: true, managerId: true } },
        awayTeam: { select: { id: true, name: true, managerId: true } }
      }
    });

    if (!match && normalizedCode.length >= 8) {
      const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedCode);
      if (isFullUuid) {
        match = await prisma.match.findUnique({
          where: { id: normalizedCode },
          include: {
            homeTeam: { select: { id: true, name: true, managerId: true } },
            awayTeam: { select: { id: true, name: true, managerId: true } }
          }
        });
      }
    }

    if (!match) {
      return res.status(404).json({ error: 'Quick Match not found for this code.' });
    }

    if (match.status === 'fulltime' || match.status === 'completed' || match.status === 'cancelled') {
      return res.status(400).json({ error: 'This match has already concluded or was cancelled.' });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: { where: { playerId: userId } }
      }
    });

    if (!team) return res.status(404).json({ error: 'Team not found.' });

    const isManager = team.managerId === userId;
    const isCaptain = team.members.some(m => m.isCaptain);
    const user = await prisma.profile.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'admin';

    if (!isManager && !isCaptain && !isAdmin && user?.role !== 'organizer') {
      return res.status(403).json({ error: 'Only team manager, captain, or organizer can join this match.' });
    }

    if (match.homeTeamId === teamId) {
      return res.status(400).json({ error: 'Your team is already the Home Team for this match.' });
    }

    if (match.awayTeamId && match.awayTeamId !== teamId) {
      return res.status(400).json({ error: 'An opposing team has already joined this Quick Match.' });
    }

    const updatedMatch = await prisma.match.update({
      where: { id: match.id },
      data: {
        awayTeamId: teamId
      },
      include: {
        tournament: { select: { id: true, name: true, format: true } },
        homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
      }
    });

    if (match.homeTeam?.managerId) {
      await createNotification({
        userId: match.homeTeam.managerId,
        title: 'Opponent Connected!',
        message: `"${team.name}" has joined your Quick Match. You can now start the match!`,
        type: 'success',
        link: `/matches/${match.id}`
      });
    }

    res.status(200).json({
      message: `Team "${team.name}" joined the Quick Match!`,
      match: {
        ...updatedMatch,
        matchCode: getMatchCodeFromMatch(updatedMatch)
      }
    });
  } catch (err) {
    console.error('Error joining quick match by code:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ all matches for a specific tournament
export const getTournamentMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const matches = await prisma.match.findMany({
      where: {
        tournamentId: tournamentId
      },
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
      orderBy: {
        matchDate: "asc"
      }
    });

    const formatted = matches.map(m => ({
      ...m,
      matchCode: getMatchCodeFromMatch(m)
    }));

    res.status(200).json({ matches: formatted });
  } catch (err) {
    console.error('Error fetching matches:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// UPDATE match details, score, and status
export const updateMatchStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { tournamentId, homeTeamId, awayTeamId, matchDate, roundName, venue, homeScore, awayScore, status, mvpPlayerId, winnerTeamId, tieBreakMethod, homePenaltyScore, awayPenaltyScore } = req.body;

    // Find the match and its parent tournament
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        tournament: true
      }
    });
    if (!match) return res.status(404).json({ error: 'Match not found.' });

    // Verify permissions
    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (match.tournament && match.tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update tournament matches.' });
    }

    const updateData = {};
    if (tournamentId !== undefined) updateData.tournamentId = tournamentId;
    if (homeTeamId !== undefined) updateData.homeTeamId = homeTeamId;
    if (awayTeamId !== undefined) updateData.awayTeamId = awayTeamId;
    if (matchDate !== undefined) updateData.matchDate = new Date(matchDate);
    if (roundName !== undefined) updateData.roundName = roundName;
    if (venue !== undefined) updateData.venue = venue;
    if (homeScore !== undefined) updateData.homeScore = homeScore;
    if (awayScore !== undefined) updateData.awayScore = awayScore;
    if (status !== undefined) updateData.status = status;
    if (mvpPlayerId !== undefined) updateData.mvpPlayerId = mvpPlayerId;
    if (winnerTeamId !== undefined) updateData.winnerTeamId = winnerTeamId;
    if (tieBreakMethod !== undefined) updateData.tieBreakMethod = tieBreakMethod;
    if (homePenaltyScore !== undefined) updateData.homePenaltyScore = homePenaltyScore;
    if (awayPenaltyScore !== undefined) updateData.awayPenaltyScore = awayPenaltyScore;

    const updatedMatch = await prisma.match.update({
      where: { id },
      data: updateData,
      include: {
        tournament: {
          select: {
            id: true,
            name: true,
            format: true
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
      }
    });

    if ((updatedMatch.status === 'fulltime' || updatedMatch.status === 'completed') && updatedMatch.tournamentId) {
      const isLeague = updatedMatch.tournament?.format === 'league';

      // Knockout logic
      if (!isLeague && updatedMatch.winnerTeamId) {
        try {
          await advanceKnockoutWinner(prisma, updatedMatch.tournamentId, id, updatedMatch.winnerTeamId, match);
          if (match.roundName === 'Final') {
            await prisma.tournament.update({
              where: { id: updatedMatch.tournamentId },
              data: { status: 'completed' }
            });
          }
        } catch (advErr) {
          console.warn('Knockout auto-advancement note:', advErr);
        }
      }

      // League logic
      if (isLeague) {
        try {
          const tMatches = await prisma.match.findMany({
            where: { tournamentId: updatedMatch.tournamentId }
          });
          const allFinished = tMatches.length > 0 && tMatches.every(
            m => m.status === 'fulltime' || m.status === 'completed'
          );
          if (allFinished) {
            await prisma.tournament.update({
              where: { id: updatedMatch.tournamentId },
              data: { status: 'completed' }
            });
          }
        } catch (err) {
          console.error('Error checking league completion:', err);
        }
      }
    }

    // ── Notify team members about match result ──────────────────────────────
    if (updatedMatch.status === 'fulltime' || updatedMatch.status === 'completed') {
      try {
        const homeScore = updatedMatch.homeScore ?? 0;
        const awayScore = updatedMatch.awayScore ?? 0;
        const homeTeamName = updatedMatch.homeTeam?.name || 'Home Team';
        const awayTeamName = updatedMatch.awayTeam?.name || 'Away Team';
        const resultMsg = `${homeTeamName} ${homeScore} – ${awayScore} ${awayTeamName}`;

        const [homeMembers, awayMembers] = await Promise.all([
          updatedMatch.homeTeamId
            ? prisma.teamMember.findMany({ where: { teamId: updatedMatch.homeTeamId }, select: { playerId: true } })
            : Promise.resolve([]),
          updatedMatch.awayTeamId
            ? prisma.teamMember.findMany({ where: { teamId: updatedMatch.awayTeamId }, select: { playerId: true } })
            : Promise.resolve([])
        ]);

        const allPlayerIds = [...new Set(
          [...homeMembers, ...awayMembers]
            .map(m => m.playerId)
            .filter(Boolean)
        )];

        await Promise.all(allPlayerIds.map(playerId =>
          createNotification({
            userId: playerId,
            title: 'Match Result',
            message: `Full time! ${resultMsg}`,
            type: 'info',
            link: `/matches/${updatedMatch.id}`
          })
        ));
      } catch (notifErr) {
        console.warn('[Notification] Failed to send match result notifications:', notifErr.message);
      }
    }

    res.status(200).json({
      message: 'Match updated!',
      match: {
        ...updatedMatch,
        matchCode: getMatchCodeFromMatch(updatedMatch)
      }
    });
  } catch (err) {
    console.error('Error updating match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE a match
export const deleteMatch = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        tournament: true
      }
    });

    if (!match) return res.status(404).json({ error: 'Match not found.' });

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (match.tournament && match.tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can delete tournament matches.' });
    }

    await prisma.match.delete({ where: { id } });

    res.status(200).json({ message: 'Match deleted successfully!' });
  } catch (err) {
    console.error('Error deleting match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

