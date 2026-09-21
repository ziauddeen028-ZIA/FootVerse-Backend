import express from 'express';
import {
  createJoinRequest,
  getRequestStatus,
  getManagerRequests,
  approveJoinRequest,
  rejectJoinRequest,
  joinByCode
} from '../controllers/teamJoinRequestController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All team join request routes require authentication
router.use(requireAuth);

// Join a team instantly using a team code (no approval needed)
router.post('/join-by-code', joinByCode);

// Create join request
router.post('/', createJoinRequest);

// Check player request status for a specific team
router.get('/status/:teamId', getRequestStatus);

// Get join requests for manager's teams
router.get('/manager', getManagerRequests);

// Approve join request
router.post('/:id/approve', approveJoinRequest);

// Reject join request
router.post('/:id/reject', rejectJoinRequest);

export default router;
