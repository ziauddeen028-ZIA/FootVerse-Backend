import express from 'express';
import { getProfile, updateProfile } from '../controllers/profileController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the requireAuth middleware to ALL routes in this file
// This ensures no one can access these without being logged in
router.use(requireAuth);

// Route: GET /api/profile
// Purpose: View own profile
router.get('/', getProfile);

// Route: PUT /api/profile
// Purpose: Update own profile
router.put('/', updateProfile);

export default router;
