import express from 'express';
import {
  createMatchEvent,
  getMatchEventsByMatch,
  updateMatchEvent,
  deleteMatchEvent
} from '../controllers/matchEventController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes (Anyone can view events for a match)
router.get('/match/:matchId', getMatchEventsByMatch);

// Protected Routes (Must be logged in to modify events)
router.use(requireAuth);

router.post('/', createMatchEvent);
router.put('/:id', updateMatchEvent);
router.delete('/:id', deleteMatchEvent);

export default router;
