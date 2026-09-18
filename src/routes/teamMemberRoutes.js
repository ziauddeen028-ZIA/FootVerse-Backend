import express from 'express';
import {
  getAllTeamMembers,
  addTeamMember,
  getTeamMembersByTeam,
  updateTeamMember,
  removeTeamMember
} from '../controllers/teamMemberController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes (Anyone can view team rosters and players)
router.get('/', getAllTeamMembers);
router.get('/team/:teamId', getTeamMembersByTeam);

// Protected Routes (Must be authenticated to manage squad members)
router.post('/', requireAuth, addTeamMember);
router.put('/:id', requireAuth, updateTeamMember);
router.delete('/:id', requireAuth, removeTeamMember);

export default router;
