import express from 'express';
import { registerUser, loginUser } from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Route: POST /api/auth/register
// Purpose: Register a new user via Supabase Auth
router.post('/register', registerUser);

// Route: POST /api/auth/login
// Purpose: Login an existing user
router.post('/login', loginUser);

// Route: GET /api/auth/me
// Purpose: Get the currently logged-in user (Protected Route)
router.get('/me', requireAuth, (req, res) => {
  // If we reach here, the middleware already checked the token!
  // req.user has been securely populated by requireAuth.
  res.status(200).json({
    message: 'You are authenticated!',
    user: req.user
  });
});

export default router;
