import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';
import crypto from 'crypto';

// ─── Helper: generate a unique 8-char uppercase alphanumeric tournament code ──
function generateTournamentCode() {
  // 6 random bytes → 12 hex chars → take first 8 and uppercase
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);
}

async function uniqueTournamentCode() {
  let attempts = 0;
  while (attempts < 10) {
    const code = generateTournamentCode();
    const existing = await prisma.tournament.findUnique({ where: { tournamentCode: code } });
    if (!existing) return code;
    attempts++;
  }
  // Fallback: extremely unlikely, but safe
  return generateTournamentCode() + Date.now().toString(36).toUpperCase().slice(-4);
}

// ─── Helper to parse embedded tournament config ──
function parseTournamentConfig(description) {
  let fieldSize = 11;
  let substitutionMode = 'normal';
  let cleanDescription = description || '';

  if (description) {
    const match = description.match(/<!--config:(.*?)-->/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.fieldSize) fieldSize = Number(parsed.fieldSize);
        if (parsed.substitutionMode) substitutionMode = parsed.substitutionMode;
        cleanDescription = description.replace(/<!--config:.*?-->/g, '').trim();
      } catch (e) {
        // ignore
      }
    }
  }

  return {
    fieldSize: (!isNaN(fieldSize) && fieldSize > 0) ? fieldSize : 11,
    substitutionMode: substitutionMode === 'rolling' ? 'rolling' : 'normal',
    cleanDescription
  };
}

function buildTournamentDescription(description, fieldSize, substitutionMode) {
  const cleanDesc = (description || '').replace(/<!--config:.*?-->/g, '').trim();
  const config = {
    fieldSize: (!isNaN(Number(fieldSize)) && Number(fieldSize) > 0) ? Number(fieldSize) : 11,
    substitutionMode: substitutionMode === 'rolling' ? 'rolling' : 'normal'
  };
  return `${cleanDesc} <!--config:${JSON.stringify(config)}-->`.trim();
}

// CREATE a new tournament
export const createTournament = async (req, res) => {
  try {
    const organizerId = req.user.id;

    // Quick security check: Is this user actually an organizer or admin?
    const user = await prisma.profile.findUnique({ where: { id: organizerId } });
    if (!user || (user.role !== 'organizer' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only organizers or admins can create tournaments.' });
    }

    const { name, slug, description, format, location, startDate, endDate, maxTeams, entryFee, fieldSize, substitutionMode } = req.body;

    if (!name || !slug || !location) {
      return res.status(400).json({ error: 'Name, slug, and location are required.' });
    }

    // Coerce and validate numeric fields before handing to Prisma.
    // Prisma expects Int for maxTeams and Decimal for entryFee.
    const parsedMaxTeams = maxTeams !== undefined ? Number(maxTeams) : 16;
    const parsedEntryFee = entryFee !== undefined ? Number(entryFee) : 0;

    if (!Number.isFinite(parsedMaxTeams) || parsedMaxTeams < 2) {
      return res.status(400).json({ error: 'maxTeams must be a valid integer of at least 2.' });
    }
    if (!Number.isFinite(parsedEntryFee) || parsedEntryFee < 0) {
      return res.status(400).json({ error: 'entryFee must be a valid non-negative number.' });
    }

    // Embed fieldSize and substitutionMode into description
    const finalDescription = buildTournamentDescription(description, fieldSize, substitutionMode);

    // Generate a unique tournament code for the organizer to share
    const tournamentCode = await uniqueTournamentCode();

    const newTournament = await prisma.tournament.create({
      data: {
        name,
        slug,
        description: finalDescription,
        format,
        location,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        maxTeams: parsedMaxTeams,
        entryFee: parsedEntryFee,
        organizerId,
        tournamentCode
      }
    });

    // Parse config for response
    const config = parseTournamentConfig(newTournament.description);
    const tournamentResponse = {
      ...newTournament,
      fieldSize: config.fieldSize,
      substitutionMode: config.substitutionMode,
    };

    // Notify the organizer that their tournament was created
    await createNotification({
      userId: organizerId,
      title: 'Tournament Created!',
      message: `Your tournament "${newTournament.name}" has been created. Share the join code "${tournamentCode}" with team captains/managers.`,
      type: 'success',
      link: `/tournaments/${newTournament.slug || newTournament.id}`
    });

    res.status(201).json({ message: 'Tournament created!', tournament: tournamentResponse });
  } catch (err) {
    console.error('Error creating tournament:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ all tournaments
// tournamentCode is stripped from the response unless the caller is the organizer or admin.
export const getAllTournaments = async (req, res) => {
  try {
    const callerId = req.user?.id ?? null;
    const callerProfile = callerId
      ? await prisma.profile.findUnique({ where: { id: callerId }, select: { role: true } })
      : null;
    const isAdmin = callerProfile?.role === 'admin';

    const rawTournaments = await prisma.tournament.findMany({
      include: {
        _count: {
          select: {
            teams: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const tournaments = rawTournaments.map(t => {
      const { _count, tournamentCode, ...rest } = t;
      const isOrganizer = callerId && t.organizerId === callerId;
      const config = parseTournamentConfig(t.description);
      return {
        ...rest,
        fieldSize: config.fieldSize,
        substitutionMode: config.substitutionMode,
        registeredTeamsCount: _count?.teams ?? 0,
        // Only expose the code to the organizer of this tournament or an admin
        ...(isOrganizer || isAdmin ? { tournamentCode } : {})
      };
    });

    res.status(200).json({ tournaments });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ a single tournament by slug or ID (Public)
export const getTournamentBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const callerId = req.user?.id ?? null;
    const callerProfile = callerId
      ? await prisma.profile.findUnique({ where: { id: callerId }, select: { role: true } })
      : null;
    const isAdmin = callerProfile?.role === 'admin';

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(slug);

    const rawTournament = await prisma.tournament.findFirst({
      where: isUuid
        ? { OR: [{ id: slug }, { slug }] }
        : { slug },
      include: {
        organizer: {
          select: {
            fullName: true,
            email: true
          }
        },
        _count: {
          select: {
            teams: true
          }
        }
      }
    });

    if (!rawTournament) return res.status(404).json({ error: 'Tournament not found.' });

    const { _count, tournamentCode, ...rest } = rawTournament;
    const isOrganizer = callerId && rawTournament.organizerId === callerId;
    const config = parseTournamentConfig(rawTournament.description);

    const tournament = {
      ...rest,
      fieldSize: config.fieldSize,
      substitutionMode: config.substitutionMode,
      registeredTeamsCount: _count?.teams ?? 0,
      // Only expose code to organizer or admin
      ...(isOrganizer || isAdmin ? { tournamentCode } : {})
    };

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

    // Coerce and validate numeric fields before handing to Prisma.
    const parsedMaxTeams = updateData.maxTeams !== undefined ? Number(updateData.maxTeams) : undefined;
    const parsedEntryFee = updateData.entryFee !== undefined ? Number(updateData.entryFee) : undefined;

    if (parsedMaxTeams !== undefined && (!Number.isFinite(parsedMaxTeams) || parsedMaxTeams < 2)) {
      return res.status(400).json({ error: 'maxTeams must be a valid integer of at least 2.' });
    }
    if (parsedEntryFee !== undefined && (!Number.isFinite(parsedEntryFee) || parsedEntryFee < 0)) {
      return res.status(400).json({ error: 'entryFee must be a valid non-negative number.' });
    }

    let finalDescription = updateData.description;
    if (updateData.fieldSize !== undefined || updateData.substitutionMode !== undefined || updateData.description !== undefined) {
      const existingConfig = parseTournamentConfig(tournament.description);
      const targetFieldSize = updateData.fieldSize !== undefined ? updateData.fieldSize : existingConfig.fieldSize;
      const targetSubMode = updateData.substitutionMode !== undefined ? updateData.substitutionMode : existingConfig.substitutionMode;
      const targetDesc = updateData.description !== undefined ? updateData.description : existingConfig.cleanDescription;
      finalDescription = buildTournamentDescription(targetDesc, targetFieldSize, targetSubMode);
    }

    const updatedTournament = await prisma.tournament.update({
      where: { id },
      data: {
        name: updateData.name,
        slug: updateData.slug,
        description: finalDescription,
        format: updateData.format,
        location: updateData.location,
        startDate: updateData.startDate
          ? new Date(updateData.startDate)
          : undefined,
        endDate: updateData.endDate
          ? new Date(updateData.endDate)
          : undefined,
        maxTeams: parsedMaxTeams,
        entryFee: parsedEntryFee
      }
    });

    const config = parseTournamentConfig(updatedTournament.description);
    const tournamentResponse = {
      ...updatedTournament,
      fieldSize: config.fieldSize,
      substitutionMode: config.substitutionMode,
    };

    res.status(200).json({ message: 'Tournament updated!', tournament: tournamentResponse });
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
