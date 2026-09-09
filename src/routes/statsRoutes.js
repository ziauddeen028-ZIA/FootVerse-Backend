import express from 'express';
import { 
  getTournamentLeaderboard, 
  updatePlayerStats,
  getTopScorer,
  getBestKeeper,
  getBestPlayer,
  setBestPlayer,
  getTournamentStatsOverview,
  getTournamentPlayers,
  getPlayerStats,
  getPlayersList,
  getTeamStats,
  getTeamPrivateDetails,
  getTeamsList,
  getPublicPlayerStats
} from '../controllers/statsController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { optionalAuth } from '../middleware/optionalAuth.js';

const router = express.Router();

// Player & Team Statistics Endpoints
router.get('/players', getPlayersList);
router.get('/player/:playerId/public', getPublicPlayerStats); // Public — no auth, no email
router.get('/player/:playerId', getPlayerStats);             // Own stats — sends auth token
router.get('/teams', getTeamsList);
router.get('/team/:teamId', optionalAuth, getTeamStats);
router.get('/team/:teamId/private', requireAuth, getTeamPrivateDetails);

// Phase 9 Step 1 Specific Routes
router.get('/tournament/:tournamentId/top-scorer', getTopScorer);
router.get('/tournament/:tournamentId/best-keeper', getBestKeeper);
router.get('/tournament/:tournamentId/best-player', getBestPlayer);
router.put('/tournament/:tournamentId/best-player', requireAuth, setBestPlayer);
router.get('/tournament/:tournamentId/overview', getTournamentStatsOverview);
router.get('/tournament/:tournamentId/players', getTournamentPlayers);

// Public Route: View leaderboard
// Example: GET /api/stats/tournament/123?sortBy=goals
router.get('/tournament/:tournamentId', getTournamentLeaderboard);

// Protected Route: Organizer updates player stats
router.put('/tournament/:tournamentId/player/:playerId', requireAuth, updatePlayerStats);

export default router;

