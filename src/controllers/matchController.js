import prisma from '../lib/prisma.js';

// CREATE (Schedule) a new match
export const scheduleMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tournamentId, homeTeamId, awayTeamId, matchDate, roundName, venue } = req.body;

    // Verify the user is the organizer of this tournament (or an admin)
    const tournament = await prisma.tournaments.findUnique({ where: { id: tournamentId } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const user = await prisma.profiles.findUnique({ where: { id: userId } });
    if (tournament.organizer_id !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can schedule matches.' });
    }

    const newMatch = await prisma.matches.create({
      data: {
        tournament_id: tournamentId,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        match_date: new Date(matchDate),
        round_name: roundName,
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

    const matches = await prisma.matches.findMany({
      where: {
        tournament_id: tournamentId
      },
      include: {
        teams_matches_home_team_idToteams: {
          select: {
            name: true,
            short_name: true,
            logo_url: true
          }
        },
        teams_matches_away_team_idToteams: {
          select: {
            name: true,
            short_name: true,
            logo_url: true
          }
        }
      },
      orderBy: {
        match_date: "asc"
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
    const match = await prisma.matches.findUnique({
      where: { id },
      include: {
        tournaments: true
      }
    });
    if (!match) return res.status(404).json({ error: 'Match not found.' });

    // Verify permissions
    const user = await prisma.profiles.findUnique({ where: { id: userId } });
    if (match.tournaments.organizer_id !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update match scores.' });
    }

    const updatedMatch = await prisma.matches.update({
      where: { id },
      data: {
        home_score: homeScore !== undefined ? homeScore : match.home_score,
        away_score: awayScore !== undefined ? awayScore : match.away_score,
        status: status || match.status,
        mvp_player_id: mvpPlayerId || match.mvp_player_id
      }
    });

    res.status(200).json({ message: 'Match updated!', match: updatedMatch });
  } catch (err) {
    console.error('Error updating match:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
