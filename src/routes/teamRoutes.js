import express from 'express';
import { 
  createTeam, 
  getAllTeams, 
  getTeamById, 
  updateTeam, 
  deleteTeam,
  getTeamCode
} from '../controllers/teamController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes (Anyone can see teams)
router.get('/', getAllTeams);
router.get('/:id', getTeamById);

// Protected Routes (You must have a valid badge)
router.post('/', requireAuth, createTeam);
router.put('/:id', requireAuth, updateTeam);
router.delete('/:id', requireAuth, deleteTeam);

// Team Code — Manager/Captain only
router.get('/:id/team-code', requireAuth, getTeamCode);

export default router;
