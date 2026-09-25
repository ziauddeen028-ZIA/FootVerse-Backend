import express from 'express';
import { 
  scheduleMatch, 
  getAllMatches,
  getMatchById,
  getMatchByCode,
  joinQuickMatchByCode,
  getTournamentMatches, 
  updateMatchStatus,
  deleteMatch
} from '../controllers/matchController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { optionalAuth } from '../middleware/optionalAuth.js';

const router = express.Router();

// Public Routes (with optionalAuth to allow caller-based query filtering)
router.get('/', optionalAuth, getAllMatches);
router.get('/tournament/:tournamentId', getTournamentMatches);
router.get('/code/:code', optionalAuth, getMatchByCode);
router.get('/:id', getMatchById);

// Protected Routes (Must be logged in)
router.post('/', requireAuth, scheduleMatch);
router.post('/quick', requireAuth, scheduleMatch);
router.post('/join-by-code', requireAuth, joinQuickMatchByCode);
router.put('/:id', requireAuth, updateMatchStatus);
router.delete('/:id', requireAuth, deleteMatch);

export default router;

