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
import { optionalAuth } from '../middleware/optionalAuth.js';

const router = express.Router();

// Public Routes (Anyone can see teams, optionalAuth enables caller-specific filtering)
router.get('/', optionalAuth, getAllTeams);
router.get('/:id', getTeamById);

// Protected Routes (You must have a valid badge)
router.post('/', requireAuth, createTeam);
router.put('/:id', requireAuth, updateTeam);
router.delete('/:id', requireAuth, deleteTeam);

// Team Code — Manager/Captain only
router.get('/:id/team-code', requireAuth, getTeamCode);

export default router;
