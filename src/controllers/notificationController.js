import prisma from '../lib/prisma.js';

// ─── Helper: create a notification (called internally by other controllers) ───
/**
 * createNotification({ userId, title, message, type, link })
 *  type: 'info' | 'success' | 'warning' | 'error'
 *  Silently swallows errors so it never breaks the parent operation.
 */
export async function createNotification({ userId, title, message, type = 'info', link = null }) {
  if (!userId || !title || !message) return null;
  try {
    return await prisma.notification.create({
      data: { userId, title, message, type, link }
    });
  } catch (err) {
    console.error('[Notification] Failed to create notification:', err.message);
    return null;
  }
}

// ─── GET /api/notifications ─────────────────────────────────────────────────
// Returns the authenticated user's notifications (newest first, max 50).
export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.status(200).json({ notifications });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── GET /api/notifications/unread-count ────────────────────────────────────
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const count = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    res.status(200).json({ count });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── PUT /api/notifications/:id/read ────────────────────────────────────────
export const markOneAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Notification not found.' });
    if (existing.userId !== userId) return res.status(403).json({ error: 'Forbidden.' });

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true }
    });

    res.status(200).json({ notification: updated });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── PUT /api/notifications/read-all ────────────────────────────────────────
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
