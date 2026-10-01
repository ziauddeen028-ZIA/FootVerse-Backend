import prisma from '../lib/prisma.js';

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
