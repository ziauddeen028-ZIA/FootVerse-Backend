import express from 'express';
import { 
  createTournament, 
  getAllTournaments, 
  getTournamentBySlug, 
  updateTournament, 
  deleteTournament,
  getOrganizerDashboard
} from '../controllers/tournamentController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { optionalAuth } from '../middleware/optionalAuth.js';

const router = express.Router();

// Organizer Dashboard route (Must precede /:slug)
router.get('/organizer/dashboard', requireAuth, getOrganizerDashboard);

// Public Routes (with optionalAuth for caller role/query filtering)
router.get('/', optionalAuth, getAllTournaments);
router.get('/:slug', optionalAuth, getTournamentBySlug); // Using slug for SEO-friendly URLs!

// Protected Routes (Must be logged in, Controller checks if they are an Organizer)
router.post('/', requireAuth, createTournament);
router.put('/:id', requireAuth, updateTournament);
router.delete('/:id', requireAuth, deleteTournament);

export default router;
