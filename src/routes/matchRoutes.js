import express from 'express';
import { 
  scheduleMatch, 
  getAllMatches,
  getMatchById,
  getTournamentMatches, 
  updateMatchStatus,
  deleteMatch
} from '../controllers/matchController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes
router.get('/', getAllMatches);
router.get('/tournament/:tournamentId', getTournamentMatches);
router.get('/:id', getMatchById);

// Protected Routes (Must be logged in, Controller verifies Organizer role)
router.post('/', requireAuth, scheduleMatch);
router.put('/:id', requireAuth, updateMatchStatus);
router.delete('/:id', requireAuth, deleteMatch);

export default router;

