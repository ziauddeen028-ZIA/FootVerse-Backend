import prisma from '../lib/prisma.js';

// READ: Get top players for a tournament (Public)
export const getTournamentLeaderboard = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sortBy = 'goals' } = req.query; // default to sorting by goals

    // Ensure we are sorting by a valid field to prevent errors
    const validSortFields = ['goals', 'assists', 'cleanSheets', 'yellowCards', 'redCards', 'mvpAwards'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'goals';

    const leaderboard = await prisma.playerStats.findMany({
      where: { tournamentId },
      include: {
        player: { select: { fullName: true, avatarUrl: true, jerseyNumber: true } }
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
        playerId_tournamentId: { playerId, tournamentId }
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
