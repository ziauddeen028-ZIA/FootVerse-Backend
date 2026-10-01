import express from 'express';
import { generateLeagueFixtures, generateGroupStageFixtures } from '../controllers/leagueController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true });

// POST /api/tournaments/:tournamentId/league/generate
router.post('/:tournamentId/league/generate', requireAuth, generateLeagueFixtures);

// POST /api/tournaments/:tournamentId/group-stage/generate (and aliases)
router.post('/:tournamentId/group-stage/generate', requireAuth, generateGroupStageFixtures);
router.post('/:tournamentId/group/generate', requireAuth, generateGroupStageFixtures);
router.post('/:tournamentId/groups/generate', requireAuth, generateGroupStageFixtures);

export default router;
