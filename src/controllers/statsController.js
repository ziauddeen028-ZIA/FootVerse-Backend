import prisma from '../lib/prisma.js';

// READ: Get top players for a tournament (Public)
export const getTournamentLeaderboard = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sortBy = 'goals' } = req.query; // default to sorting by goals

    // Ensure we are sorting by a valid field to prevent errors
    const validSortFields = [
      "goals",
      "assists",
      "cleanSheets",
      "yellowCards",
      "redCards",
      "mvpAwards"
    ];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'goals';

    const leaderboard = await prisma.playerStats.findMany({
      where: {
        tournamentId: tournamentId
      },
      include: {
        player: {
          select: {
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true
          }
        }
      },
      orderBy: { [sortField]: 'desc' },
      take: 20 // Top 20 players
    });

    res.status(200).json({ leaderboard });
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// UPDATE: Modify a player's stats (Organizer only)
export const updatePlayerStats = async (req, res) => {
  try {
    const { tournamentId, playerId } = req.params;
    const userId = req.user.id;
    const { goals, assists, yellowCards, redCards, cleanSheets, mvpAwards } = req.body;

    // Verify the user is the organizer of the tournament
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update player stats.' });
    }

    // Upsert: Update the stats if they exist, or Create them if this is the player's first stat entry!
    const updatedStats = await prisma.playerStats.upsert({
      where: {
        playerId_tournamentId: {
          playerId,
          tournamentId
        }
      },
      update: {
        goals: { increment: goals || 0 },
        assists: { increment: assists || 0 },
        yellowCards: { increment: yellowCards || 0 },
        redCards: { increment: redCards || 0 },
        cleanSheets: { increment: cleanSheets || 0 },
        mvpAwards: { increment: mvpAwards || 0 },
        matchesPlayed: { increment: 1 } // Assume updating stats means they played a match
      },
      create: {
        playerId,
        tournamentId,
        goals: goals || 0,
        assists: assists || 0,
        yellowCards: yellowCards || 0,
        redCards: redCards || 0,
        cleanSheets: cleanSheets || 0,
        mvpAwards: mvpAwards || 0,
        matchesPlayed: 1
      }
    });

    res.status(200).json({ message: 'Player stats updated!', stats: updatedStats });
  } catch (err) {
    console.error('Error updating player stats:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// PHASE 9 STEP 1: TOP SCORER
// Calculates automatically from existing goal MatchEvents for a tournament
export const getTopScorer = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const goalEvents = await prisma.matchEvent.findMany({
      where: {
        match: { tournamentId },
        eventType: 'goal',
        playerId: { not: null }
      },
      include: {
        player: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true,
            preferredPosition: true
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true
          }
        }
      }
    });

    if (goalEvents.length === 0) {
      return res.status(200).json({
        tournament: { id: tournament.id, name: tournament.name },
        topScorer: null,
        maxGoals: 0,
        leaderboard: []
      });
    }

    const playerGoalMap = {};
    for (const event of goalEvents) {
      const pid = event.playerId;
      if (!playerGoalMap[pid]) {
        playerGoalMap[pid] = {
          player: event.player,
          team: event.team,
          goals: 0
        };
      }
      playerGoalMap[pid].goals += 1;
    }

    const leaderboard = Object.values(playerGoalMap).sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals;
      return (a.player?.fullName || '').localeCompare(b.player?.fullName || '');
    });

    const maxGoals = leaderboard[0]?.goals || 0;
    const topScorers = leaderboard.filter(item => item.goals === maxGoals);

    return res.status(200).json({
      tournament: { id: tournament.id, name: tournament.name },
      topScorer: topScorers[0],
      topScorers,
      maxGoals,
      leaderboard
    });
  } catch (err) {
    console.error('Error calculating top scorer:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// PHASE 9 STEP 1: BEST KEEPER
// Calculates clean sheets from completed/fulltime matches for goalkeepers
export const getBestKeeper = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const completedMatches = await prisma.match.findMany({
      where: {
        tournamentId,
        status: 'fulltime'
      },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true
      }
    });

    if (completedMatches.length === 0) {
      return res.status(200).json({
        tournament: { id: tournament.id, name: tournament.name },
        bestKeeper: null,
        maxCleanSheets: 0,
        leaderboard: []
      });
    }

    // Determine clean sheets kept per team in completed matches
    const teamCleanSheets = {};
    for (const match of completedMatches) {
      const homeScore = match.homeScore ?? 0;
      const awayScore = match.awayScore ?? 0;

      if (match.homeTeamId && awayScore === 0) {
        teamCleanSheets[match.homeTeamId] = (teamCleanSheets[match.homeTeamId] || 0) + 1;
      }
      if (match.awayTeamId && homeScore === 0) {
        teamCleanSheets[match.awayTeamId] = (teamCleanSheets[match.awayTeamId] || 0) + 1;
      }
    }

    const cleanSheetTeamIds = Object.keys(teamCleanSheets);
    if (cleanSheetTeamIds.length === 0) {
      return res.status(200).json({
        tournament: { id: tournament.id, name: tournament.name },
        bestKeeper: null,
        maxCleanSheets: 0,
        leaderboard: []
      });
    }

    const keeperMap = {};

    for (const teamId of cleanSheetTeamIds) {
      const cleanSheetsCount = teamCleanSheets[teamId];

      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId },
        include: {
          player: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              jerseyNumber: true,
              preferredPosition: true
            }
          },
          team: {
            select: {
              id: true,
              name: true,
              shortName: true,
              logoUrl: true
            }
          }
        }
      });

      const matchEvents = await prisma.matchEvent.findMany({
        where: {
          teamId,
          match: { tournamentId }
        },
        include: {
          player: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              jerseyNumber: true,
              preferredPosition: true
            }
          },
          team: {
            select: {
              id: true,
              name: true,
              shortName: true,
              logoUrl: true
            }
          }
        }
      });

      const candidatePlayersMap = {};
      for (const tm of teamMembers) {
        if (tm.player) {
          candidatePlayersMap[tm.playerId] = {
            player: tm.player,
            team: tm.team,
            position: tm.position
          };
        }
      }
      for (const me of matchEvents) {
        if (me.player && !candidatePlayersMap[me.playerId]) {
          candidatePlayersMap[me.playerId] = {
            player: me.player,
            team: me.team,
            position: me.player.preferredPosition
          };
        }
      }

      const candidates = Object.values(candidatePlayersMap);
      if (candidates.length === 0) continue;

      const goalkeepers = candidates.filter(c => {
        const pos = (c.position || '').toLowerCase();
        const prefPos = (c.player?.preferredPosition || '').toLowerCase();
        return pos.includes('goalkeeper') || pos === 'gk' || prefPos.includes('goalkeeper') || prefPos === 'gk';
      });

      const targetKeepers = goalkeepers.length > 0 ? goalkeepers : candidates;

      for (const k of targetKeepers) {
        const pid = k.player.id;
        if (!keeperMap[pid]) {
          keeperMap[pid] = {
            player: k.player,
            team: k.team,
            cleanSheets: 0
          };
        }
        keeperMap[pid].cleanSheets += cleanSheetsCount;
      }
    }

    const leaderboard = Object.values(keeperMap).sort((a, b) => {
      if (b.cleanSheets !== a.cleanSheets) return b.cleanSheets - a.cleanSheets;
      return (a.player?.fullName || '').localeCompare(b.player?.fullName || '');
    });

    if (leaderboard.length === 0) {
      return res.status(200).json({
        tournament: { id: tournament.id, name: tournament.name },
        bestKeeper: null,
        maxCleanSheets: 0,
        leaderboard: []
      });
    }

    const maxCleanSheets = leaderboard[0].cleanSheets;
    const bestKeepers = leaderboard.filter(k => k.cleanSheets === maxCleanSheets);

    return res.status(200).json({
      tournament: { id: tournament.id, name: tournament.name },
      bestKeeper: bestKeepers[0],
      bestKeepers,
      maxCleanSheets,
      leaderboard
    });
  } catch (err) {
    console.error('Error calculating best keeper:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// PHASE 9 STEP 1: BEST PLAYER GET
export const getBestPlayer = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        name: true,
        bestPlayerId: true,
        bestPlayer: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true,
            preferredPosition: true,
            email: true
          }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    return res.status(200).json({
      tournament: { id: tournament.id, name: tournament.name },
      bestPlayer: tournament.bestPlayer || null
    });
  } catch (err) {
    console.error('Error fetching best player:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// PHASE 9 STEP 1: BEST PLAYER SET (Organizer only)
export const setBestPlayer = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { playerId } = req.body;
    const userId = req.user.id;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can select the Best Player for this tournament.' });
    }

    if (playerId) {
      const playerProfile = await prisma.profile.findUnique({ where: { id: playerId } });
      if (!playerProfile) {
        return res.status(404).json({ error: 'Selected player profile not found.' });
      }
    }

    const updatedTournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        bestPlayerId: playerId || null
      },
      include: {
        bestPlayer: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true,
            preferredPosition: true
          }
        }
      }
    });

    let bestPlayerWithTeam = null;
    if (updatedTournament.bestPlayer) {
      const bestPlayerMembership = await prisma.teamMember.findFirst({
        where: {
          playerId: updatedTournament.bestPlayer.id,
          team: { tournamentId }
        },
        include: {
          team: {
            select: { id: true, name: true, shortName: true, logoUrl: true }
          }
        }
      });
      bestPlayerWithTeam = {
        ...updatedTournament.bestPlayer,
        team: bestPlayerMembership?.team || null,
        jerseyNumber: bestPlayerMembership?.jerseyNumber ?? updatedTournament.bestPlayer.jerseyNumber ?? null,
        preferredPosition: bestPlayerMembership?.position || updatedTournament.bestPlayer.preferredPosition || ''
      };
    }

    return res.status(200).json({
      message: 'Best Player selected successfully!',
      tournament: {
        id: updatedTournament.id,
        name: updatedTournament.name,
        bestPlayer: bestPlayerWithTeam
      }
    });
  } catch (err) {
    console.error('Error setting best player:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// PHASE 9 STEP 1: STATS OVERVIEW FOR TOURNAMENT
export const getTournamentStatsOverview = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        name: true,
        bestPlayerId: true,
        bestPlayer: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true,
            preferredPosition: true
          }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    // 1. Top Scorer
    const goalEvents = await prisma.matchEvent.findMany({
      where: {
        match: { tournamentId },
        eventType: 'goal',
        playerId: { not: null }
      },
      include: {
        player: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true,
            preferredPosition: true
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true
          }
        }
      }
    });

    let topScorer = null;
    if (goalEvents.length > 0) {
      const playerGoalMap = {};
      for (const event of goalEvents) {
        const pid = event.playerId;
        if (!playerGoalMap[pid]) {
          playerGoalMap[pid] = {
            player: event.player,
            team: event.team,
            goals: 0
          };
        }
        playerGoalMap[pid].goals += 1;
      }
      const sortedScorers = Object.values(playerGoalMap).sort((a, b) => b.goals - a.goals);
      topScorer = sortedScorers[0] || null;
    }

    // 2. Best Keeper
    const completedMatches = await prisma.match.findMany({
      where: {
        tournamentId,
        status: 'fulltime'
      },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true
      }
    });

    let bestKeeper = null;
    if (completedMatches.length > 0) {
      const teamCleanSheets = {};
      for (const match of completedMatches) {
        const homeScore = match.homeScore ?? 0;
        const awayScore = match.awayScore ?? 0;
        if (match.homeTeamId && awayScore === 0) {
          teamCleanSheets[match.homeTeamId] = (teamCleanSheets[match.homeTeamId] || 0) + 1;
        }
        if (match.awayTeamId && homeScore === 0) {
          teamCleanSheets[match.awayTeamId] = (teamCleanSheets[match.awayTeamId] || 0) + 1;
        }
      }
      const cleanSheetTeamIds = Object.keys(teamCleanSheets);
      if (cleanSheetTeamIds.length > 0) {
        const keeperMap = {};
        for (const teamId of cleanSheetTeamIds) {
          const cleanSheetsCount = teamCleanSheets[teamId];
          const teamMembers = await prisma.teamMember.findMany({
            where: { teamId },
            include: {
              player: {
                select: {
                  id: true,
                  fullName: true,
                  avatarUrl: true,
                  jerseyNumber: true,
                  preferredPosition: true
                }
              },
              team: {
                select: {
                  id: true,
                  name: true,
                  shortName: true,
                  logoUrl: true
                }
              }
            }
          });

          const matchEvents = await prisma.matchEvent.findMany({
            where: { teamId, match: { tournamentId } },
            include: {
              player: {
                select: {
                  id: true,
                  fullName: true,
                  avatarUrl: true,
                  jerseyNumber: true,
                  preferredPosition: true
                }
              },
              team: {
                select: {
                  id: true,
                  name: true,
                  shortName: true,
                  logoUrl: true
                }
              }
            }
          });

          const candidatePlayersMap = {};
          for (const tm of teamMembers) {
            if (tm.player) {
              candidatePlayersMap[tm.playerId] = {
                player: tm.player,
                team: tm.team,
                position: tm.position
              };
            }
          }
          for (const me of matchEvents) {
            if (me.player && !candidatePlayersMap[me.playerId]) {
              candidatePlayersMap[me.playerId] = {
                player: me.player,
                team: me.team,
                position: me.player.preferredPosition
              };
            }
          }

          const candidates = Object.values(candidatePlayersMap);
          if (candidates.length === 0) continue;

          const goalkeepers = candidates.filter(c => {
            const pos = (c.position || '').toLowerCase();
            const prefPos = (c.player?.preferredPosition || '').toLowerCase();
            return pos.includes('goalkeeper') || pos === 'gk' || prefPos.includes('goalkeeper') || prefPos === 'gk';
          });

          const targetKeepers = goalkeepers.length > 0 ? goalkeepers : candidates;

          for (const k of targetKeepers) {
            const pid = k.player.id;
            if (!keeperMap[pid]) {
              keeperMap[pid] = {
                player: k.player,
                team: k.team,
                cleanSheets: 0
              };
            }
            keeperMap[pid].cleanSheets += cleanSheetsCount;
          }
        }

        const sortedKeepers = Object.values(keeperMap).sort((a, b) => b.cleanSheets - a.cleanSheets);
        bestKeeper = sortedKeepers[0] || null;
      }
    }

    let bestPlayerWithTeam = null;
    if (tournament.bestPlayer) {
      const bestPlayerMembership = await prisma.teamMember.findFirst({
        where: {
          playerId: tournament.bestPlayer.id,
          team: { tournamentId }
        },
        include: {
          team: {
            select: { id: true, name: true, shortName: true, logoUrl: true }
          }
        }
      });
      bestPlayerWithTeam = {
        ...tournament.bestPlayer,
        team: bestPlayerMembership?.team || null,
        jerseyNumber: bestPlayerMembership?.jerseyNumber ?? tournament.bestPlayer.jerseyNumber ?? null,
        preferredPosition: bestPlayerMembership?.position || tournament.bestPlayer.preferredPosition || ''
      };
    }

    return res.status(200).json({
      tournament: { id: tournament.id, name: tournament.name },
      topScorer,
      bestKeeper,
      bestPlayer: bestPlayerWithTeam
    });
  } catch (err) {
    console.error('Error fetching tournament stats overview:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// PHASE 9 STEP 1: GET TOURNAMENT PLAYERS
// Returns all unique players belonging to teams registered in this tournament
export const getTournamentPlayers = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const members = await prisma.teamMember.findMany({
      where: {
        team: {
          tournamentId
        }
      },
      include: {
        player: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            jerseyNumber: true,
            preferredPosition: true
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    });

    const playerMap = {};
    for (const m of members) {
      if (m.player && !playerMap[m.player.id]) {
        playerMap[m.player.id] = {
          id: m.player.id,
          fullName: m.player.fullName || 'Unknown',
          avatarUrl: m.player.avatarUrl || null,
          jerseyNumber: m.jerseyNumber ?? m.player.jerseyNumber ?? null,
          preferredPosition: m.position || m.player.preferredPosition || '',
          teamId: m.team?.id,
          teamName: m.team?.name || ''
        };
      }
    }

    return res.status(200).json({ players: Object.values(playerMap) });
  } catch (err) {
    console.error('Error fetching tournament players:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ==========================================
// PLAYER & TEAM STATS (Phase Scope)
// ==========================================

/**
 * GET /api/stats/player/:playerId
 * Returns overall player statistics (goals, matches, tournaments)
 * and tournament history with detailed performance per tournament.
 * Keeps overall and tournament stats strictly separate.
 */
export const getPlayerStats = async (req, res) => {
  try {
    const { playerId } = req.params;

    const player = await prisma.profile.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        preferredPosition: true,
        jerseyNumber: true,
        role: true,
        bio: true
      }
    });

    if (!player) {
      return res.status(404).json({ error: 'Player profile not found.' });
    }

    // 1. Fetch all match events involving this player
    const matchEvents = await prisma.matchEvent.findMany({
      where: { playerId },
      include: {
        team: {
          select: { id: true, name: true, shortName: true, logoUrl: true }
        },
        match: {
          include: {
            tournament: true,
            homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
          }
        }
      },
      orderBy: { minute: 'asc' }
    });

    // 2. Fetch all team memberships for this player
    const teamMemberships = await prisma.teamMember.findMany({
      where: { playerId },
      include: {
        team: {
          include: {
            tournament: true,
            homeMatches: {
              where: { status: 'fulltime' },
              include: {
                tournament: true,
                awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
              }
            },
            awayMatches: {
              where: { status: 'fulltime' },
              include: {
                tournament: true,
                homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
              }
            }
          }
        }
      }
    });

    // 3. Collect distinct tournaments across memberships and events
    const tournamentMap = {};

    // From team memberships
    for (const membership of teamMemberships) {
      const team = membership.team;
      if (!team) continue;

      const tourn = team.tournament;
      if (tourn && !tournamentMap[tourn.id]) {
        tournamentMap[tourn.id] = {
          tournament: {
            id: tourn.id,
            name: tourn.name,
            slug: tourn.slug,
            format: tourn.format,
            status: tourn.status,
            startDate: tourn.startDate,
            endDate: tourn.endDate,
            location: tourn.location
          },
          team: {
            id: team.id,
            name: team.name,
            shortName: team.shortName,
            logoUrl: team.logoUrl
          },
          matchesMap: {}
        };
      }

      // Add all completed matches played by this team in this tournament
      const allTeamMatches = [
        ...(team.homeMatches || []).map(m => ({ ...m, isHome: true, opponent: m.awayTeam })),
        ...(team.awayMatches || []).map(m => ({ ...m, isHome: false, opponent: m.homeTeam }))
      ];

      for (const m of allTeamMatches) {
        const tournId = m.tournamentId || tourn?.id;
        if (!tournId) continue;

        if (!tournamentMap[tournId]) {
          const tObj = m.tournament || tourn;
          tournamentMap[tournId] = {
            tournament: {
              id: tournId,
              name: tObj?.name || 'Tournament',
              slug: tObj?.slug || '',
              format: tObj?.format || 'knockout',
              status: tObj?.status || 'completed',
              startDate: tObj?.startDate || null,
              endDate: tObj?.endDate || null,
              location: tObj?.location || null
            },
            team: {
              id: team.id,
              name: team.name,
              shortName: team.shortName,
              logoUrl: team.logoUrl
            },
            matchesMap: {}
          };
        }

        const teamScore = m.isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0);
        const oppScore = m.isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0);
        let result = 'D';
        if (teamScore > oppScore) result = 'W';
        else if (teamScore < oppScore) result = 'L';

        tournamentMap[tournId].matchesMap[m.id] = {
          id: m.id,
          date: m.matchDate,
          roundName: m.roundName || 'Match',
          opponent: m.opponent?.name || 'Opponent',
          opponentLogo: m.opponent?.logoUrl || null,
          teamScore,
          oppScore,
          scoreDisplay: `${teamScore} - ${oppScore}`,
          result,
          playerGoals: 0
        };
      }
    }

    // From match events (in case player played without explicit team membership record)
    for (const event of matchEvents) {
      const match = event.match;
      if (!match) continue;
      const tourn = match.tournament;
      const tournId = match.tournamentId || (tourn ? tourn.id : null);
      if (!tournId) continue;

      if (!tournamentMap[tournId]) {
        tournamentMap[tournId] = {
          tournament: {
            id: tournId,
            name: tourn?.name || 'Tournament',
            slug: tourn?.slug || '',
            format: tourn?.format || 'knockout',
            status: tourn?.status || 'completed',
            startDate: tourn?.startDate || null,
            endDate: tourn?.endDate || null,
            location: tourn?.location || null
          },
          team: event.team ? {
            id: event.team.id,
            name: event.team.name,
            shortName: event.team.shortName,
            logoUrl: event.team.logoUrl
          } : null,
          matchesMap: {}
        };
      }

      if (!tournamentMap[tournId].matchesMap[match.id]) {
        const isHome = event.teamId === match.homeTeamId;
        const teamScore = isHome ? (match.homeScore ?? 0) : (match.awayScore ?? 0);
        const oppScore = isHome ? (match.awayScore ?? 0) : (match.homeScore ?? 0);
        const opponent = isHome ? match.awayTeam : match.homeTeam;

        let result = 'D';
        if (teamScore > oppScore) result = 'W';
        else if (teamScore < oppScore) result = 'L';

        tournamentMap[tournId].matchesMap[match.id] = {
          id: match.id,
          date: match.matchDate,
          roundName: match.roundName || 'Match',
          opponent: opponent?.name || 'Opponent',
          opponentLogo: opponent?.logoUrl || null,
          teamScore,
          oppScore,
          scoreDisplay: `${teamScore} - ${oppScore}`,
          result,
          playerGoals: 0
        };
      }

      // Count goals scored in this match
      if (event.eventType === 'goal') {
        tournamentMap[tournId].matchesMap[match.id].playerGoals += 1;
      }
    }

    // 4. Calculate Overall and Tournament Stats
    const totalGoalEvents = matchEvents.filter(e => e.eventType === 'goal').length;
    const allPlayedMatchIds = new Set();

    const tournamentList = Object.values(tournamentMap).map(tEntry => {
      const matches = Object.values(tEntry.matchesMap).sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );

      matches.forEach(m => allPlayedMatchIds.add(m.id));

      const tournamentGoals = matches.reduce((sum, m) => sum + m.playerGoals, 0);

      return {
        tournament: tEntry.tournament,
        team: tEntry.team,
        tournamentStats: {
          matchesPlayed: matches.length,
          goals: tournamentGoals
        },
        matches
      };
    });

    // Sort tournaments by start date or name
    tournamentList.sort((a, b) => {
      if (a.tournament.startDate && b.tournament.startDate) {
        return new Date(b.tournament.startDate) - new Date(a.tournament.startDate);
      }
      return (a.tournament.name || '').localeCompare(b.tournament.name || '');
    });

    // Distinct overall matches played
    const overallMatchesPlayed = allPlayedMatchIds.size;
    const overallTournamentsPlayed = tournamentList.length;

    return res.status(200).json({
      player,
      // Overall career performance (strictly separated)
      overallStats: {
        goals: totalGoalEvents,
        matchesPlayed: overallMatchesPlayed,
        tournamentsPlayed: overallTournamentsPlayed
      },
      // Tournament history with detailed performance per tournament
      tournaments: tournamentList
    });
  } catch (err) {
    console.error('Error fetching player stats:', err);
    return res.status(500).json({ error: 'Internal server error while fetching player statistics.' });
  }
};

/**
 * GET /api/stats/players
 * Returns list of players for quick searching and stats preview
 */
export const getPlayersList = async (req, res) => {
  try {
    const { search = '' } = req.query;

    const players = await prisma.profile.findMany({
      where: {
        role: { in: ['player', 'organizer', 'team_manager', 'admin'] },
        ...(search
          ? {
              OR: [
                // Note: email intentionally NOT searched here — public endpoint
                { fullName: { contains: search, mode: 'insensitive' } },
                { preferredPosition: { contains: search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: {
        teamMemberships: {
          include: {
            team: { select: { id: true, name: true, shortName: true, logoUrl: true } }
          }
        },
        matchEvents: {
          where: { eventType: 'goal' },
          select: { id: true }
        }
      },
      take: 50
    });

    const formatted = players.map(p => {
      const primaryTeam = p.teamMemberships[0]?.team || null;
      return {
        id: p.id,
        fullName: p.fullName || 'Athlete',
        // email intentionally omitted — public endpoint
        avatarUrl: p.avatarUrl,
        preferredPosition: p.preferredPosition || 'Player',
        jerseyNumber: p.jerseyNumber,
        teamName: primaryTeam?.name || 'Free Agent',
        teamId: primaryTeam?.id || null,
        goals: p.matchEvents.length
      };
    });

    return res.status(200).json({ players: formatted });
  } catch (err) {
    console.error('Error listing players for stats:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * GET /api/stats/teams
 * Returns list of teams for quick searching and selecting in Team Stats
 */
export const getTeamsList = async (req, res) => {
  try {
    const { search = '' } = req.query;

    const teams = await prisma.team.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { shortName: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } }
            ]
          }
        : {},
      include: {
        tournament: { select: { id: true, name: true } },
        members: { select: { id: true } },
        homeMatches: { where: { status: 'fulltime' }, select: { id: true } },
        awayMatches: { where: { status: 'fulltime' }, select: { id: true } }
      },
      take: 50
    });

    const formatted = teams.map(t => ({
      id: t.id,
      name: t.name,
      shortName: t.shortName,
      logoUrl: t.logoUrl,
      city: t.city,
      primaryColor: t.primaryColor,
      tournamentName: t.tournament?.name || 'Tournament',
      squadCount: t.members.length,
      matchesPlayed: t.homeMatches.length + t.awayMatches.length
    }));

    return res.status(200).json({ teams: formatted });
  } catch (err) {
    console.error('Error listing teams for stats:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * GET /api/stats/player/:playerId/public
 * Public stats for any player — accessible by anyone (no auth required).
 * Enforces privacy: strips email, strips any private team/roster data.
 * Returns goals, matches, tournaments, tournament history, and match-by-match goals.
 */
export const getPublicPlayerStats = async (req, res) => {
  try {
    const { playerId } = req.params;

    const player = await prisma.profile.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        fullName: true,
        // email intentionally OMITTED — public endpoint
        avatarUrl: true,
        preferredPosition: true,
        jerseyNumber: true,
        bio: true
        // role intentionally OMITTED — no need to expose user roles publicly
      }
    });

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' });
    }

    // Fetch goal events for this player
    const matchEvents = await prisma.matchEvent.findMany({
      where: { playerId },
      include: {
        team: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        match: {
          include: {
            tournament: true,
            homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
          }
        }
      },
      orderBy: { minute: 'asc' }
    });

    // Fetch team memberships to get tournament match history
    const teamMemberships = await prisma.teamMember.findMany({
      where: { playerId },
      include: {
        team: {
          include: {
            tournament: true,
            homeMatches: {
              where: { status: 'fulltime' },
              include: {
                tournament: true,
                awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
              }
            },
            awayMatches: {
              where: { status: 'fulltime' },
              include: {
                tournament: true,
                homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } }
              }
            }
          }
        }
      }
    });

    const tournamentMap = {};

    for (const membership of teamMemberships) {
      const team = membership.team;
      if (!team) continue;
      const tourn = team.tournament;
      if (tourn && !tournamentMap[tourn.id]) {
        tournamentMap[tourn.id] = {
          tournament: { id: tourn.id, name: tourn.name, slug: tourn.slug, format: tourn.format, status: tourn.status, startDate: tourn.startDate, endDate: tourn.endDate, location: tourn.location },
          // Only team name and logo — no roster, no private details
          team: { id: team.id, name: team.name, shortName: team.shortName, logoUrl: team.logoUrl },
          matchesMap: {}
        };
      }
      const allTeamMatches = [
        ...(team.homeMatches || []).map(m => ({ ...m, isHome: true, opponent: m.awayTeam })),
        ...(team.awayMatches || []).map(m => ({ ...m, isHome: false, opponent: m.homeTeam }))
      ];
      for (const m of allTeamMatches) {
        const tournId = m.tournamentId || tourn?.id;
        if (!tournId) continue;
        if (!tournamentMap[tournId]) {
          const tObj = m.tournament || tourn;
          tournamentMap[tournId] = {
            tournament: { id: tournId, name: tObj?.name || 'Tournament', slug: tObj?.slug || '', format: tObj?.format || 'knockout', status: tObj?.status || 'completed', startDate: tObj?.startDate || null, endDate: tObj?.endDate || null, location: tObj?.location || null },
            team: { id: team.id, name: team.name, shortName: team.shortName, logoUrl: team.logoUrl },
            matchesMap: {}
          };
        }
        const teamScore = m.isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0);
        const oppScore = m.isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0);
        let result = 'D';
        if (teamScore > oppScore) result = 'W';
        else if (teamScore < oppScore) result = 'L';
        tournamentMap[tournId].matchesMap[m.id] = { id: m.id, date: m.matchDate, roundName: m.roundName || 'Match', opponent: m.opponent?.name || 'Opponent', opponentLogo: m.opponent?.logoUrl || null, teamScore, oppScore, scoreDisplay: `${teamScore} - ${oppScore}`, result, playerGoals: 0 };
      }
    }

    for (const event of matchEvents) {
      const match = event.match;
      if (!match) continue;
      const tourn = match.tournament;
      const tournId = match.tournamentId || tourn?.id;
      if (!tournId) continue;
      if (!tournamentMap[tournId]) {
        tournamentMap[tournId] = {
          tournament: { id: tournId, name: tourn?.name || 'Tournament', slug: tourn?.slug || '', format: tourn?.format || 'knockout', status: tourn?.status || 'completed', startDate: tourn?.startDate || null, endDate: tourn?.endDate || null, location: tourn?.location || null },
          team: event.team ? { id: event.team.id, name: event.team.name, shortName: event.team.shortName, logoUrl: event.team.logoUrl } : null,
          matchesMap: {}
        };
      }
      if (!tournamentMap[tournId].matchesMap[match.id]) {
        const isHome = event.teamId === match.homeTeamId;
        const teamScore = isHome ? (match.homeScore ?? 0) : (match.awayScore ?? 0);
        const oppScore = isHome ? (match.awayScore ?? 0) : (match.homeScore ?? 0);
        const opponent = isHome ? match.awayTeam : match.homeTeam;
        let result = 'D';
        if (teamScore > oppScore) result = 'W';
        else if (teamScore < oppScore) result = 'L';
        tournamentMap[tournId].matchesMap[match.id] = { id: match.id, date: match.matchDate, roundName: match.roundName || 'Match', opponent: opponent?.name || 'Opponent', opponentLogo: opponent?.logoUrl || null, teamScore, oppScore, scoreDisplay: `${teamScore} - ${oppScore}`, result, playerGoals: 0 };
      }
      if (event.eventType === 'goal') {
        tournamentMap[tournId].matchesMap[match.id].playerGoals += 1;
      }
    }

    const totalGoals = matchEvents.filter(e => e.eventType === 'goal').length;
    const allMatchIds = new Set();
    const tournamentList = Object.values(tournamentMap).map(tEntry => {
      const matches = Object.values(tEntry.matchesMap).sort((a, b) => new Date(b.date) - new Date(a.date));
      matches.forEach(m => allMatchIds.add(m.id));
      const tournamentGoals = matches.reduce((sum, m) => sum + m.playerGoals, 0);
      return { tournament: tEntry.tournament, team: tEntry.team, tournamentStats: { matchesPlayed: matches.length, goals: tournamentGoals }, matches };
    });
    tournamentList.sort((a, b) => {
      if (a.tournament.startDate && b.tournament.startDate) return new Date(b.tournament.startDate) - new Date(a.tournament.startDate);
      return (a.tournament.name || '').localeCompare(b.tournament.name || '');
    });

    return res.status(200).json({
      player, // no email in this object
      overallStats: { goals: totalGoals, matchesPlayed: allMatchIds.size, tournamentsPlayed: tournamentList.length },
      tournaments: tournamentList
      // NO private team roster or private data included
    });
  } catch (err) {
    console.error('Error fetching public player stats:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * GET /api/stats/team/:teamId
 * Returns overall team performance, tournament and match history (public),
 * and detailed roster performance (private to team members, manager, and admin).
 */
export const getTeamStats = async (req, res) => {
  try {
    const { teamId } = req.params;
    const currentUserId = req.user?.id || null;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        tournament: true,
        manager: {
          select: { id: true, fullName: true, email: true, avatarUrl: true }
        },
        members: {
          include: {
            player: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                preferredPosition: true,
                jerseyNumber: true,
                email: true
              }
            }
          }
        },
        homeMatches: {
          where: { status: 'fulltime' },
          include: {
            tournament: true,
            awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            events: { where: { eventType: 'goal' } }
          }
        },
        awayMatches: {
          where: { status: 'fulltime' },
          include: {
            tournament: true,
            homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            events: { where: { eventType: 'goal' } }
          }
        }
      }
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found.' });
    }

    // Check authorization
    let isAuthorizedMember = false;
    if (currentUserId) {
      const isManager = team.managerId === currentUserId;
      const isMember = team.members.some(m => m.playerId === currentUserId);
      const userProfile = await prisma.profile.findUnique({
        where: { id: currentUserId },
        select: { role: true }
      });
      const isAdmin = userProfile?.role === 'admin';
      isAuthorizedMember = Boolean(isManager || isMember || isAdmin);
    }

    const allMatches = [
      ...(team.homeMatches || []).map(m => ({
        id: m.id,
        date: m.matchDate,
        roundName: m.roundName || 'Match',
        tournamentId: m.tournamentId || team.tournamentId,
        tournamentName: m.tournament?.name || team.tournament?.name || 'Tournament',
        isHome: true,
        opponent: m.awayTeam?.name || 'Opponent',
        opponentLogo: m.awayTeam?.logoUrl || null,
        goalsFor: m.homeScore ?? 0,
        goalsAgainst: m.awayScore ?? 0,
        events: m.events || []
      })),
      ...(team.awayMatches || []).map(m => ({
        id: m.id,
        date: m.matchDate,
        roundName: m.roundName || 'Match',
        tournamentId: m.tournamentId || team.tournamentId,
        tournamentName: m.tournament?.name || team.tournament?.name || 'Tournament',
        isHome: false,
        opponent: m.homeTeam?.name || 'Opponent',
        opponentLogo: m.homeTeam?.logoUrl || null,
        goalsFor: m.awayScore ?? 0,
        goalsAgainst: m.homeScore ?? 0,
        events: m.events || []
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0, cleanSheets = 0;

    const matchHistory = allMatches.map(m => {
      goalsFor += m.goalsFor;
      goalsAgainst += m.goalsAgainst;
      let result = 'D';
      if (m.goalsFor > m.goalsAgainst) { result = 'W'; wins += 1; }
      else if (m.goalsFor < m.goalsAgainst) { result = 'L'; losses += 1; }
      else { draws += 1; }
      if (m.goalsAgainst === 0) cleanSheets += 1;
      return {
        id: m.id,
        date: m.date,
        tournamentName: m.tournamentName,
        roundName: m.roundName,
        opponent: m.opponent,
        opponentLogo: m.opponentLogo,
        isHome: m.isHome,
        scoreDisplay: `${m.goalsFor} - ${m.goalsAgainst}`,
        result
      };
    });

    const tournamentHistoryMap = {};
    if (team.tournament) {
      tournamentHistoryMap[team.tournament.id] = {
        id: team.tournament.id,
        name: team.tournament.name,
        format: team.tournament.format,
        status: team.tournament.status,
        matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0
      };
    }
    for (const m of allMatches) {
      const tId = m.tournamentId;
      if (!tId) continue;
      if (!tournamentHistoryMap[tId]) {
        tournamentHistoryMap[tId] = { id: tId, name: m.tournamentName, format: 'tournament', status: 'completed', matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
      }
      const tStat = tournamentHistoryMap[tId];
      tStat.matchesPlayed += 1;
      tStat.goalsFor += m.goalsFor;
      tStat.goalsAgainst += m.goalsAgainst;
      if (m.goalsFor > m.goalsAgainst) tStat.wins += 1;
      else if (m.goalsFor < m.goalsAgainst) tStat.losses += 1;
      else tStat.draws += 1;
    }

    const tournamentHistory = Object.values(tournamentHistoryMap);

    // Public Squad (accessible to guests and all users)
    const squad = (team.members || []).map(member => {
      const p = member.player;
      if (!p) return null;
      return {
        id: p.id,
        fullName: p.fullName || 'Player',
        avatarUrl: p.avatarUrl || null,
        position: member.position || p.preferredPosition || 'Player',
        jerseyNumber: member.jerseyNumber ?? p.jerseyNumber ?? null,
        isCaptain: member.isCaptain || false
      };
    }).filter(Boolean);

    squad.sort((a, b) => {
      if (a.isCaptain && !b.isCaptain) return -1;
      if (!a.isCaptain && b.isCaptain) return 1;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });

    let detailedPerformance = null;
    if (isAuthorizedMember) {
      const roster = team.members.map(member => {
        const p = member.player;
        if (!p) return null;
        let goalsForThisTeam = 0;
        for (const m of allMatches) {
          for (const ev of m.events) {
            if (ev.playerId === p.id && ev.teamId === team.id && ev.eventType === 'goal') goalsForThisTeam += 1;
          }
        }
        return {
          id: p.id,
          fullName: p.fullName || 'Player',
          email: p.email,
          avatarUrl: p.avatarUrl,
          position: member.position || p.preferredPosition || 'Player',
          jerseyNumber: member.jerseyNumber ?? p.jerseyNumber ?? null,
          isCaptain: member.isCaptain || false,
          matchesPlayed: allMatches.length,
          goals: goalsForThisTeam
        };
      }).filter(Boolean);

      roster.sort((a, b) => {
        if (a.isCaptain && !b.isCaptain) return -1;
        if (!a.isCaptain && b.isCaptain) return 1;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return (a.fullName || '').localeCompare(b.fullName || '');
      });

      detailedPerformance = { roster, squadSize: roster.length };
    }

    return res.status(200).json({
      team: {
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        logoUrl: team.logoUrl,
        primaryColor: team.primaryColor,
        secondaryColor: team.secondaryColor,
        city: team.city,
        homeGround: team.homeGround,
        manager: team.manager?.fullName || 'Manager'
      },
      isAuthorizedMember,
      overallPerformance: { matchesPlayed: allMatches.length, wins, draws, losses, goalsFor, goalsAgainst, cleanSheets, tournamentsCount: tournamentHistory.length },
      tournamentHistory,
      matchHistory,
      squad,
      detailedPerformance
    });
  } catch (err) {
    console.error('Error fetching team stats:', err);
    return res.status(500).json({ error: 'Internal server error while fetching team statistics.' });
  }
};

/**
 * GET /api/stats/team/:teamId/private
 * Strict protected route for detailed team/roster performance.
 * Outside users receive 403 Forbidden.
 */
export const getTeamPrivateDetails = async (req, res) => {
  try {
    const { teamId } = req.params;
    const currentUserId = req.user.id;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        manager: true,
        members: {
          include: {
            player: {
              select: { id: true, fullName: true, avatarUrl: true, preferredPosition: true, jerseyNumber: true, email: true }
            }
          }
        },
        homeMatches: { where: { status: 'fulltime' }, include: { events: true } },
        awayMatches: { where: { status: 'fulltime' }, include: { events: true } }
      }
    });

    if (!team) return res.status(404).json({ error: 'Team not found.' });

    const isManager = team.managerId === currentUserId;
    const isMember = team.members.some(m => m.playerId === currentUserId);
    const userProfile = await prisma.profile.findUnique({ where: { id: currentUserId }, select: { role: true } });
    const isAdmin = userProfile?.role === 'admin';

    if (!isManager && !isMember && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Detailed team roster and performance are private to squad members, manager, and administrators.' });
    }

    const allMatches = [...(team.homeMatches || []), ...(team.awayMatches || [])];
    const roster = team.members.map(member => {
      const p = member.player;
      if (!p) return null;
      let goals = 0;
      for (const m of allMatches) {
        for (const ev of (m.events || [])) {
          if (ev.playerId === p.id && ev.teamId === team.id && ev.eventType === 'goal') goals += 1;
        }
      }
      return {
        id: p.id,
        fullName: p.fullName || 'Player',
        email: p.email,
        avatarUrl: p.avatarUrl,
        position: member.position || p.preferredPosition || 'Player',
        jerseyNumber: member.jerseyNumber ?? p.jerseyNumber ?? null,
        isCaptain: member.isCaptain || false,
        matchesPlayed: allMatches.length,
        goals
      };
    }).filter(Boolean);

    return res.status(200).json({
      teamId: team.id,
      teamName: team.name,
      detailedPerformance: { roster, squadSize: roster.length }
    });
  } catch (err) {
    console.error('Error fetching private team details:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
