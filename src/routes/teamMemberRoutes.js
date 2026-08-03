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

// Apply requireAuth middleware to all routes in this module
router.use(requireAuth);

router.get('/', getAllTeamMembers);
router.post('/', addTeamMember);
router.get('/team/:teamId', getTeamMembersByTeam);
router.put('/:id', updateTeamMember);
router.delete('/:id', removeTeamMember);

export default router;
