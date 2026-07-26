import express from 'express';
import { 
  scheduleMatch, 
  getTournamentMatches, 
  updateMatchStatus 
} from '../controllers/matchController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Route (Anyone can see the match schedules and scores)
router.get('/tournament/:tournamentId', getTournamentMatches);

// Protected Routes (Must be logged in, Controller verifies Organizer role)
router.post('/', requireAuth, scheduleMatch);
router.put('/:id', requireAuth, updateMatchStatus);

export default router;
