import express from 'express';
import { generateLeagueFixtures } from '../controllers/leagueController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true });

// POST /api/tournaments/:tournamentId/league/generate
router.post('/:tournamentId/league/generate', requireAuth, generateLeagueFixtures);

export default router;
