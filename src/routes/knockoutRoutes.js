import express from 'express';
import { generateKnockoutBracket, generateHybridKnockoutBracket, updateKnockoutMatch, updateKnockoutMatchResult } from '../controllers/knockoutController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true });

// POST /api/tournaments/:tournamentId/knockout/generate
router.post('/:tournamentId/knockout/generate', generateKnockoutBracket);

// POST /api/tournaments/:tournamentId/hybrid/generate
router.post('/:tournamentId/hybrid/generate', generateHybridKnockoutBracket);

// PUT /api/tournaments/:tournamentId/knockout/matches/:matchId
router.put('/:tournamentId/knockout/matches/:matchId', requireAuth, updateKnockoutMatch);

// PUT /api/tournaments/:tournamentId/knockout/matches/:matchId/result
router.put('/:tournamentId/knockout/matches/:matchId/result', requireAuth, updateKnockoutMatchResult);

export default router;
