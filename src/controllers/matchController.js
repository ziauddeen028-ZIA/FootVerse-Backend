import prisma from '../lib/prisma.js';
import { advanceKnockoutWinner } from './knockoutController.js';

// CREATE (Schedule) a new match
export const scheduleMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tournamentId, homeTeamId, awayTeamId, matchDate, roundName, venue, status } = req.body;

    // Verify the user is the organizer of this tournament (or an admin)
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can schedule matches.' });
    }

    const newMatch = await prisma.match.create({
      data: {
        tournamentId: tournamentId,
        homeTeamId: homeTeamId,
        awayTeamId: awayTeamId,
        matchDate: new Date(matchDate),
        roundName: roundName || 'Group Stage',
        venue: venue || null,
        status: status || 'scheduled'
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

    res.status(201).json({ message: 'Match scheduled!', match: newMatch });
  } catch (err) {
    console.error('Error scheduling match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ all matches
export const getAllMatches = async (req, res) => {
  try {
    const matches = await prisma.match.findMany({
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
      },
      orderBy: {
        matchDate: "asc"
      }
    });

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

    res.status(200).json({ match });
  } catch (err) {
    console.error('Error fetching match by ID:', err);
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
        }
      },
      orderBy: {
        matchDate: "asc"
      }
    });
    res.status(200).json({ matches });
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
      return res.status(403).json({ error: 'Only the organizer can update matches.' });
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

    if ((updatedMatch.status === 'fulltime' || updatedMatch.status === 'completed') && updatedMatch.winnerTeamId && updatedMatch.tournamentId) {
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

    res.status(200).json({ message: 'Match updated!', match: updatedMatch });
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
      return res.status(403).json({ error: 'Only the organizer can delete matches.' });
    }

    await prisma.match.delete({ where: { id } });

    res.status(200).json({ message: 'Match deleted successfully!' });
  } catch (err) {
    console.error('Error deleting match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

