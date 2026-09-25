import express from 'express';
import {
  getAllTeamMembers,
  addTeamMember,
  getTeamMembersByTeam,
  getTeamMembersByPlayer,
  updateTeamMember,
  removeTeamMember
} from '../controllers/teamMemberController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { optionalAuth } from '../middleware/optionalAuth.js';

const router = express.Router();

// Public Routes (Anyone can view team rosters and players, optionalAuth enables filtering)
router.get('/', optionalAuth, getAllTeamMembers);
router.get('/team/:teamId', getTeamMembersByTeam);
router.get('/player/:playerId', getTeamMembersByPlayer);

// Protected Routes (Must be authenticated to manage squad members)
router.post('/', requireAuth, addTeamMember);
router.put('/:id', requireAuth, updateTeamMember);
router.delete('/:id', requireAuth, removeTeamMember);

export default router;
