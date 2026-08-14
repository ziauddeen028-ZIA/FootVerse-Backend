import express from 'express';
import { generateKnockoutBracket, updateKnockoutMatch } from '../controllers/knockoutController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true });

// POST /api/tournaments/:tournamentId/knockout/generate
router.post('/:tournamentId/knockout/generate', generateKnockoutBracket);

// PUT /api/tournaments/:tournamentId/knockout/matches/:matchId
router.put('/:tournamentId/knockout/matches/:matchId', requireAuth, updateKnockoutMatch);

export default router;
