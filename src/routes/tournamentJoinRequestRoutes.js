import express from 'express';
import {
  createJoinRequest,
  getRequestStatus,
  getOrganizerRequests,
  approveJoinRequest,
  rejectJoinRequest,
  joinByCode
} from '../controllers/tournamentJoinRequestController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Join a tournament instantly using an invite code (Captain/Manager only)
router.post('/join-by-code', joinByCode);

// Create tournament join request (Team Manager/Captain)
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

