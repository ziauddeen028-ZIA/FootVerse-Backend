import express from 'express';
import { 
  createTournament, 
  getAllTournaments, 
  getTournamentBySlug, 
  updateTournament, 
  deleteTournament 
} from '../controllers/tournamentController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Routes
router.get('/', getAllTournaments);
router.get('/:slug', getTournamentBySlug); // Using slug for SEO-friendly URLs!

// Protected Routes (Must be logged in, Controller checks if they are an Organizer)
router.post('/', requireAuth, createTournament);
router.put('/:id', requireAuth, updateTournament);
router.delete('/:id', requireAuth, deleteTournament);

export default router;
