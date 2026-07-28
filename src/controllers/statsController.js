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
      "clean_sheets",
      "yellow_cards",
      "red_cards",
      "mvp_awards"
    ];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'goals';

    const leaderboard = await prisma.player_stats.findMany({
      where: {
        tournament_id: tournamentId
      },
      include: {
        profiles: { select: { full_name: true, avatar_url: true, jersey_number: true } }
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
    const tournament = await prisma.tournaments.findUnique({ where: { id: tournamentId } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const user = await prisma.profiles.findUnique({ where: { id: userId } });
    if (tournament.organizer_id !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update player stats.' });
    }

    // Upsert: Update the stats if they exist, or Create them if this is the player's first stat entry!
    const updatedStats = await prisma.player_stats.upsert({
      where: {
        player_id_tournament_id: { player_id: playerId, tournament_id: tournamentId }
      },
      update: {
        goals: { increment: goals || 0 },
        assists: { increment: assists || 0 },
        yellow_cards: { increment: yellowCards || 0 },
        red_cards: { increment: redCards || 0 },
        clean_sheets: { increment: cleanSheets || 0 },
        mvp_awards: { increment: mvpAwards || 0 },
        matches_played: { increment: 1 } // Assume updating stats means they played a match
      },
      create: {
        player_id: playerId,
        tournament_id: tournamentId,
        goals: goals || 0,
        assists: assists || 0,
        yellow_cards: yellowCards || 0,
        red_cards: redCards || 0,
        clean_sheets: cleanSheets || 0,
        mvp_awards: mvpAwards || 0,
        matches_played: 1
      }
    });

    res.status(200).json({ message: 'Player stats updated!', stats: updatedStats });
  } catch (err) {
    console.error('Error updating player stats:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
