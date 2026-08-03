import prisma from '../lib/prisma.js';

// CREATE (Schedule) a new match
export const scheduleMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tournamentId, homeTeamId, awayTeamId, matchDate, roundName, venue } = req.body;

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
        roundName: roundName,
        venue,
        status: 'scheduled'
      }
    });

    res.status(201).json({ message: 'Match scheduled!', match: newMatch });
  } catch (err) {
    console.error('Error scheduling match:', err);
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
        homeTeam: {
          select: {
            name: true,
            shortName: true,
            logoUrl: true
          }
        },
        awayTeam: {
          select: {
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

// UPDATE match score and status
export const updateMatchStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { homeScore, awayScore, status, mvpPlayerId } = req.body;

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
    if (match.tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update match scores.' });
    }

    const updatedMatch = await prisma.match.update({
      where: { id },
      data: {
        homeScore: homeScore !== undefined ? homeScore : match.homeScore,
        awayScore: awayScore !== undefined ? awayScore : match.awayScore,
        status: status || match.status,
        mvpPlayerId: mvpPlayerId || match.mvpPlayerId
      }
    });

    res.status(200).json({ message: 'Match updated!', match: updatedMatch });
  } catch (err) {
    console.error('Error updating match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
