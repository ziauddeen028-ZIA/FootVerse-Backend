import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';

// POST /api/match-events
export const createMatchEvent = async (req, res) => {
  try {
    const { matchId, teamId, playerId, minute, eventType, details } = req.body;

    if (!matchId || minute === undefined || !eventType) {
      return res.status(400).json({ error: 'matchId, minute, and eventType are required.' });
    }

    const newEvent = await prisma.matchEvent.create({
      data: {
        matchId,
        teamId,
        playerId,
        minute,
        eventType,
        details
      }
    });

    res.status(201).json({ message: 'Match event created!', matchEvent: newEvent });

    // ── Fire goal notification (non-blocking) ───────────────────────────
    const GOAL_EVENTS = ['goal', 'own_goal', 'penalty'];
    if (GOAL_EVENTS.includes(eventType) && matchId) {
      (async () => {
        try {
          const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: {
              homeTeamId: true, awayTeamId: true,
              homeScore: true, awayScore: true,
              homeTeam: { select: { name: true } },
              awayTeam: { select: { name: true } }
            }
          });
          if (!match) return;

          const scorer = await (playerId
            ? prisma.profile.findUnique({ where: { id: playerId }, select: { fullName: true } })
            : Promise.resolve(null)
          );

          const eventLabel = eventType === 'own_goal' ? 'Own Goal' : eventType === 'penalty' ? 'Penalty Goal' : 'Goal';
          const scorerName = scorer?.fullName || 'Unknown';
          const title = `⚽ ${eventLabel} at minute ${minute}!`;
          const message = `${scorerName} scored a ${eventLabel.toLowerCase()} for ${match.homeTeam?.name || 'a team'} vs ${match.awayTeam?.name || 'a team'}.`;

          const [homeMembers, awayMembers] = await Promise.all([
            match.homeTeamId ? prisma.teamMember.findMany({ where: { teamId: match.homeTeamId }, select: { playerId: true } }) : [],
            match.awayTeamId ? prisma.teamMember.findMany({ where: { teamId: match.awayTeamId }, select: { playerId: true } }) : []
          ]);

          const allPlayerIds = [...new Set(
            [...homeMembers, ...awayMembers].map(m => m.playerId).filter(Boolean)
          )];

          await Promise.all(allPlayerIds.map(uid =>
            createNotification({ userId: uid, title, message, type: 'info', link: `/matches/${matchId}` })
          ));
        } catch (notifErr) {
          console.warn('[Notification] Goal notification failed:', notifErr.message);
        }
      })();
    }
  } catch (err) {
    console.error('Error creating match event:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// GET /api/match-events/match/:matchId
export const getMatchEventsByMatch = async (req, res) => {
  try {
    const { matchId } = req.params;

    const events = await prisma.matchEvent.findMany({
      where: { matchId },
      include: {
        player: {
          select: {
            fullName: true,
            email: true,
            avatarUrl: true
          }
        },
        team: {
          select: {
            name: true,
            shortName: true,
            logoUrl: true
          }
        }
      },
      orderBy: {
        minute: 'asc'
      }
    });

    res.status(200).json({ matchEvents: events });
  } catch (err) {
    console.error('Error fetching match events:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// PUT /api/match-events/:id
export const updateMatchEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { teamId, playerId, minute, eventType, details } = req.body;

    const existingEvent = await prisma.matchEvent.findUnique({ where: { id } });
    if (!existingEvent) return res.status(404).json({ error: 'Match event not found.' });

    const updatedEvent = await prisma.matchEvent.update({
      where: { id },
      data: {
        teamId,
        playerId,
        minute,
        eventType,
        details
      }
    });

    res.status(200).json({ message: 'Match event updated!', matchEvent: updatedEvent });
  } catch (err) {
    console.error('Error updating match event:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE /api/match-events/:id
export const deleteMatchEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const existingEvent = await prisma.matchEvent.findUnique({ where: { id } });
    if (!existingEvent) return res.status(404).json({ error: 'Match event not found.' });

    await prisma.matchEvent.delete({ where: { id } });

    res.status(200).json({ message: 'Match event deleted successfully.' });
  } catch (err) {
    console.error('Error deleting match event:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
