import express from 'express';
import {
  getMyNotifications,
  getUnreadCount,
  markOneAsRead,
  markAllAsRead
} from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All notification routes require authentication
router.get('/',              requireAuth, getMyNotifications);
router.get('/unread-count',  requireAuth, getUnreadCount);
router.put('/read-all',      requireAuth, markAllAsRead);
router.put('/:id/read',      requireAuth, markOneAsRead);

export default router;
