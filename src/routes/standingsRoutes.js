import express from 'express';
import { getTournamentStandings } from '../controllers/standingsController.js';

const router = express.Router({ mergeParams: true });

// Public Routes
router.get('/:tournamentId/standings', getTournamentStandings);

export default router;
