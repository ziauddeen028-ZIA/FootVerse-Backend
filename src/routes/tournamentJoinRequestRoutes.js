import express from 'express';
import {
  createJoinRequest,
  getRequestStatus,
  getOrganizerRequests,
  approveJoinRequest,
  rejectJoinRequest
} from '../controllers/tournamentJoinRequestController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Create tournament join request (Team Manager)
router.post('/', createJoinRequest);

// Get request status for a team and tournament
router.get('/status/:tournamentId/:teamId', getRequestStatus);

// Get join requests for tournaments hosted by organizer
router.get('/organizer', getOrganizerRequests);

// Approve tournament join request (Organizer)
router.post('/:id/approve', approveJoinRequest);

// Reject tournament join request (Organizer)
router.post('/:id/reject', rejectJoinRequest);

export default router;
