import express from 'express';
import { 
  getTournamentLeaderboard, 
  updatePlayerStats 
} from '../controllers/statsController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Route: View leaderboard
// Example: GET /api/stats/tournament/123?sortBy=goals
router.get('/tournament/:tournamentId', getTournamentLeaderboard);

// Protected Route: Organizer updates player stats
router.put('/tournament/:tournamentId/player/:playerId', requireAuth, updatePlayerStats);

export default router;
