import prisma from '../lib/prisma.js';

// CREATE a new tournament
export const createTournament = async (req, res) => {
  try {
    const organizerId = req.user.id;

    // Quick security check: Is this user actually an organizer or admin?
    const user = await prisma.profile.findUnique({ where: { id: organizerId } });
    if (!user || (user.role !== 'organizer' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only organizers or admins can create tournaments.' });
    }

    const { name, slug, description, format, location, startDate, endDate, maxTeams, entryFee } = req.body;

    if (!name || !slug || !location) {
      return res.status(400).json({ error: 'Name, slug, and location are required.' });
    }

    const newTournament = await prisma.tournament.create({
      data: {
        name,
        slug,
        description,
        format,
        location,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        maxTeams: maxTeams,
        entryFee: entryFee,
        organizerId: organizerId
      }
    });

    res.status(201).json({ message: 'Tournament created!', tournament: newTournament });
  } catch (err) {
    console.error('Error creating tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ all tournaments (Public)
export const getAllTournaments = async (req, res) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ tournaments });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ a single tournament by slug (Public)
export const getTournamentBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { slug },
      include: {
        organizer: {
          select: {
            fullName: true,
            email: true
          }
        }
      }
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    res.status(200).json({ tournament });
  } catch (err) {
    console.error('Error fetching tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// UPDATE a tournament
export const updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    const tournament = await prisma.tournament.findUnique({ where: { id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    // Only the organizer (or an admin) can update
    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can update this tournament.' });
    }

    const updatedTournament = await prisma.tournament.update({
      where: { id },
      data: {
        name: updateData.name,
        slug: updateData.slug,
        description: updateData.description,
        format: updateData.format,
        location: updateData.location,
        startDate: updateData.startDate
          ? new Date(updateData.startDate)
          : undefined,
        endDate: updateData.endDate
          ? new Date(updateData.endDate)
          : undefined,
        maxTeams: updateData.maxTeams,
        entryFee: updateData.entryFee
      }
    });

    res.status(200).json({ message: 'Tournament updated!', tournament: updatedTournament });
  } catch (err) {
    console.error('Error updating tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE a tournament
export const deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const tournament = await prisma.tournament.findUnique({ where: { id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (tournament.organizerId !== userId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the organizer can delete this tournament.' });
    }

    await prisma.tournament.delete({ where: { id } });

    res.status(200).json({ message: 'Tournament deleted successfully.' });
  } catch (err) {
    console.error('Error deleting tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
