import express from 'express';
import {
  createMatchEvent,
  getMatchEventsByMatch,
  updateMatchEvent,
  deleteMatchEvent
} from '../controllers/matchEventController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(requireAuth);

router.post('/', createMatchEvent);
router.get('/match/:matchId', getMatchEventsByMatch);
router.put('/:id', updateMatchEvent);
router.delete('/:id', deleteMatchEvent);

export default router;
