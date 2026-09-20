import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';

// ─── POST /api/tournament-join-requests ────────────────────────────────────
// Team Manager requests to register a team for a tournament
export const createJoinRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tournamentId, teamId } = req.body;

    if (!tournamentId || !teamId) {
      return res.status(400).json({ error: 'Tournament ID and Team ID are required.' });
    }

    // Verify team exists & verify user is team manager or team captain
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { manager: true }
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found.' });
    }

    const isCaptainMember = await prisma.teamMember.findFirst({
      where: { teamId, playerId: userId, isCaptain: true }
    });

    if (team.managerId !== userId && !isCaptainMember && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Only the team manager or team captain can submit a join request for this team.' });
    }

    // Verify tournament exists & check capacity
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    const registeredTeamCount = await prisma.team.count({ where: { tournamentId } });
    if (tournament.maxTeams !== null && registeredTeamCount >= tournament.maxTeams) {
      return res.status(400).json({ error: 'Tournament is full. No more join requests can be processed.' });
    }

    // Check if team is already registered for this tournament
    if (team.tournamentId === tournamentId) {
      return res.status(400).json({ error: 'This team is already registered for this tournament.' });
    }

    // Check for existing pending request
    const existingPending = await prisma.tournamentJoinRequest.findFirst({
      where: { tournamentId, teamId, status: 'pending' }
    });

    if (existingPending) {
      return res.status(400).json({ error: 'You already have a pending join request for this tournament.' });
    }

    // Create or update join request record
    const existingRequest = await prisma.tournamentJoinRequest.findFirst({
      where: { tournamentId, teamId }
    });

    let joinRequest;
    if (existingRequest) {
      joinRequest = await prisma.tournamentJoinRequest.update({
        where: { id: existingRequest.id },
        data: { status: 'pending', updatedAt: new Date() },
        include: { tournament: true, team: true }
      });
    } else {
      joinRequest = await prisma.tournamentJoinRequest.create({
        data: {
          tournamentId,
          teamId,
          status: 'pending'
        },
        include: { tournament: true, team: true }
      });
    }

    // Notify tournament organizer if organizer exists and is not the requester
    if (tournament.organizerId && tournament.organizerId !== userId) {
      await createNotification({
        userId: tournament.organizerId,
        title: 'New Tournament Join Request',
        message: `Team "${team.name}" requested to join "${tournament.name}".`,
        type: 'info',
        link: `/organizer/tournaments`
      });
    }

    res.status(201).json({ message: 'Tournament join request submitted successfully!', joinRequest });
  } catch (err) {
    console.error('Error creating tournament join request:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── GET /api/tournament-join-requests/status/:tournamentId/:teamId ────────
// Get current request status for a specific team and tournament
export const getRequestStatus = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    const isRegistered = team?.tournamentId === tournamentId;

    const joinRequest = await prisma.tournamentJoinRequest.findFirst({
      where: { tournamentId, teamId },
      orderBy: { updatedAt: 'desc' }
    });

    res.status(200).json({
      status: joinRequest ? joinRequest.status : 'none',
      isRegistered,
      joinRequest: joinRequest || null
    });
  } catch (err) {
    console.error('Error fetching tournament request status:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── GET /api/tournament-join-requests/organizer ───────────────────────────
// Fetch tournament join requests for tournaments hosted by the organizer
export const getOrganizerRequests = async (req, res) => {
  try {
    const organizerId = req.user.id;
    const { tournamentId } = req.query;

    let tournamentIds = [];
    if (tournamentId) {
      tournamentIds = [tournamentId];
    } else {
      const hostedTournaments = await prisma.tournament.findMany({
        where: { organizerId },
        select: { id: true }
      });
      tournamentIds = hostedTournaments.map(t => t.id);
    }

    if (tournamentIds.length === 0 && req.user.role !== 'admin') {
      return res.status(200).json({ joinRequests: [] });
    }

    const whereClause = tournamentIds.length > 0 ? { tournamentId: { in: tournamentIds } } : {};

    const joinRequests = await prisma.tournamentJoinRequest.findMany({
      where: whereClause,
      include: {
        team: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true,
            city: true,
            primaryColor: true,
            manager: {
              select: {
                id: true,
                fullName: true,
                email: true
              }
            }
          }
        },
        tournament: {
          select: {
            id: true,
            name: true,
            maxTeams: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ joinRequests });
  } catch (err) {
    console.error('Error fetching organizer join requests:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── POST /api/tournament-join-requests/:id/approve ────────────────────────
// Organizer approves a team's tournament join request & registers team into tournament
export const approveJoinRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const request = await prisma.tournamentJoinRequest.findUnique({
      where: { id },
      include: { tournament: true, team: true }
    });

    if (!request) {
      return res.status(404).json({ error: 'Tournament join request not found.' });
    }

    // Verify organizer permission
    if (request.tournament?.organizerId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Only the tournament organizer can approve join requests.' });
    }

    // Check capacity
    const registeredCount = await prisma.team.count({
      where: { tournamentId: request.tournamentId }
    });

    if (request.tournament?.maxTeams !== null && registeredCount >= request.tournament.maxTeams) {
      return res.status(400).json({ error: 'Tournament is full. Cannot approve join request.' });
    }

    // Mark request as approved
    const updatedRequest = await prisma.tournamentJoinRequest.update({
      where: { id },
      data: { status: 'approved', updatedAt: new Date() },
      include: { tournament: true, team: true }
    });

    // Register team to tournament using existing mechanism (setting team.tournamentId)
    await prisma.team.update({
      where: { id: request.teamId },
      data: { tournamentId: request.tournamentId }
    });

    // Notify team manager
    if (request.team?.managerId) {
      await createNotification({
        userId: request.team.managerId,
        title: 'Tournament Request Approved',
        message: `Your request for "${request.team.name}" to join "${request.tournament?.name}" has been approved!`,
        type: 'success',
        link: `/tournaments/${request.tournamentId}`
      });
    }

    res.status(200).json({
      message: 'Tournament Request Approved',
      joinRequest: updatedRequest
    });
  } catch (err) {
    console.error('Error approving tournament join request:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── POST /api/tournament-join-requests/:id/reject ─────────────────────────
// Organizer rejects a team's tournament join request
export const rejectJoinRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const request = await prisma.tournamentJoinRequest.findUnique({
      where: { id },
      include: { tournament: true, team: true }
    });

    if (!request) {
      return res.status(404).json({ error: 'Tournament join request not found.' });
    }

    // Verify organizer permission
    if (request.tournament?.organizerId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Only the tournament organizer can reject join requests.' });
    }

    // Mark request as rejected (do NOT alter team.tournamentId)
    const updatedRequest = await prisma.tournamentJoinRequest.update({
      where: { id },
      data: { status: 'rejected', updatedAt: new Date() },
      include: { tournament: true, team: true }
    });

    // Notify team manager
    if (request.team?.managerId) {
      await createNotification({
        userId: request.team.managerId,
        title: 'Tournament Request Rejected',
        message: `Your request for "${request.team.name}" to join "${request.tournament?.name}" was rejected.`,
        type: 'warning',
        link: `/tournaments/${request.tournamentId}`
      });
    }

    res.status(200).json({
      message: 'Tournament Request Rejected',
      joinRequest: updatedRequest
    });
  } catch (err) {
    console.error('Error rejecting tournament join request:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── POST /api/tournament-join-requests/join-by-code ───────────────────────
// Captain/Manager directly registers a team using the organizer-issued code.
// Validation: valid code → caller is manager or captain → not already registered
//             → no existing pending/approved request → capacity available.
// On success: team.tournamentId is set immediately (no approval needed) and
//             a TournamentJoinRequest row with status 'code_join' is created
//             for audit purposes.
export const joinByCode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code, teamId } = req.body;

    if (!code || !teamId) {
      return res.status(400).json({ error: 'Tournament code and team ID are required.' });
    }

    // ── 1. Resolve caller's profile role ──────────────────────────────────
    const callerProfile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    const callerRole = callerProfile?.role;

    // Plain players (and guests) cannot use the code-join path at all
    if (!callerRole || callerRole === 'guest' || callerRole === 'player') {
      return res.status(403).json({
        error: 'Forbidden: Only a team manager or team captain can join via tournament code.'
      });
    }

    // ── 2. Look up tournament by code ─────────────────────────────────────
    const normalizedCode = String(code).trim().toUpperCase();
    const tournament = await prisma.tournament.findUnique({
      where: { tournamentCode: normalizedCode }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Invalid tournament code. Please check and try again.' });
    }

    // ── 3. Verify the team exists ─────────────────────────────────────────
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { manager: true }
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found.' });
    }

    // ── 4. Verify caller is manager or captain of this team ───────────────
    const isCaptainMember = await prisma.teamMember.findFirst({
      where: { teamId, playerId: userId, isCaptain: true }
    });

    const isTeamManager = team.managerId === userId;

    if (!isTeamManager && !isCaptainMember && callerRole !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden: You must be the team manager or team captain to join on behalf of this team.'
      });
    }

    // ── 5. Check team is not already registered for this tournament ───────
    if (team.tournamentId === tournament.id) {
      return res.status(400).json({ error: 'This team is already registered for this tournament.' });
    }

    // ── 6. Check for an existing pending or approved request ──────────────
    const existingRequest = await prisma.tournamentJoinRequest.findFirst({
      where: {
        tournamentId: tournament.id,
        teamId,
        status: { in: ['pending', 'approved', 'code_join'] }
      }
    });

    if (existingRequest) {
      return res.status(400).json({
        error: `This team already has an active or approved join request for "${tournament.name}".`
      });
    }

    // ── 7. Check tournament capacity ──────────────────────────────────────
    const registeredCount = await prisma.team.count({
      where: { tournamentId: tournament.id }
    });

    if (tournament.maxTeams !== null && registeredCount >= tournament.maxTeams) {
      return res.status(400).json({
        error: `"${tournament.name}" is full. No more teams can be registered.`
      });
    }

    // ── 8. Register the team immediately (set team.tournamentId) ──────────
    await prisma.team.update({
      where: { id: teamId },
      data: { tournamentId: tournament.id }
    });

    // ── 9. Create an audit record ─────────────────────────────────────────
    const auditRecord = await prisma.tournamentJoinRequest.create({
      data: {
        tournamentId: tournament.id,
        teamId,
        status: 'code_join'
      },
      include: { tournament: true, team: true }
    });

    // ── 10. Notify organizer ──────────────────────────────────────────────
    if (tournament.organizerId && tournament.organizerId !== userId) {
      await createNotification({
        userId: tournament.organizerId,
        title: 'Team Joined via Code',
        message: `"${team.name}" joined "${tournament.name}" using the tournament invite code.`,
        type: 'info',
        link: `/organizer/tournaments`
      });
    }

    // ── 11. Notify the team manager (if different from the caller) ─────────
    if (team.managerId && team.managerId !== userId) {
      await createNotification({
        userId: team.managerId,
        title: 'Team Registered for Tournament',
        message: `Your team "${team.name}" was registered for "${tournament.name}" using the tournament invite code.`,
        type: 'success',
        link: `/tournaments/${tournament.id}`
      });
    }

    res.status(200).json({
      message: `"${team.name}" has been successfully registered for "${tournament.name}"!`,
      joinRequest: auditRecord
    });
  } catch (err) {
    console.error('Error joining tournament by code:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

