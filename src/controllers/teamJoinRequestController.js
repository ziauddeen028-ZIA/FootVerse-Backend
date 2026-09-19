import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';

// ─── POST /api/team-join-requests ───────────────────────────────────────────
// Create a new join request for a player
export const createJoinRequest = async (req, res) => {
  try {
    const playerId = req.user.id;
    const { teamId } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required.' });
    }

    // Verify team exists
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      return res.status(404).json({ error: 'Team not found.' });
    }

    // Check if player is already a team member
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_playerId: { teamId, playerId }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: 'You are already a member of this team.' });
    }

    // Check if player has an existing pending join request
    const existingPending = await prisma.teamJoinRequest.findFirst({
      where: { teamId, playerId, status: 'pending' }
    });

    if (existingPending) {
      return res.status(400).json({ error: 'You already have a pending join request for this team.' });
    }

    // Check if there is an existing request (e.g. rejected previously) to reuse or create new
    const existingRequest = await prisma.teamJoinRequest.findFirst({
      where: { teamId, playerId }
    });

    let joinRequest;
    if (existingRequest) {
      joinRequest = await prisma.teamJoinRequest.update({
        where: { id: existingRequest.id },
        data: { status: 'pending', updatedAt: new Date() },
        include: { team: true, player: true }
      });
    } else {
      joinRequest = await prisma.teamJoinRequest.create({
        data: {
          teamId,
          playerId,
          status: 'pending'
        },
        include: { team: true, player: true }
      });
    }

    // Notify the team manager if manager exists and is not the requesting player
    if (team.managerId && team.managerId !== playerId) {
      const playerProfile = await prisma.profile.findUnique({ where: { id: playerId } });
      const playerName = playerProfile?.fullName || 'A player';
      await createNotification({
        userId: team.managerId,
        title: 'New Team Join Request',
        message: `${playerName} requested to join ${team.name}.`,
        type: 'info',
        link: `/teams/${teamId}`
      });
    }

    res.status(201).json({ message: 'Join request created successfully!', joinRequest });
  } catch (err) {
    console.error('Error creating join request:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── GET /api/team-join-requests/status/:teamId ──────────────────────────────
// Fetch the current user's join request status for a specific team
export const getRequestStatus = async (req, res) => {
  try {
    const playerId = req.user.id;
    const { teamId } = req.params;

    // Check if user is already a member
    const isMember = await prisma.teamMember.findUnique({
      where: {
        teamId_playerId: { teamId, playerId }
      }
    });

    // Fetch request record if exists
    const joinRequest = await prisma.teamJoinRequest.findFirst({
      where: { teamId, playerId },
      orderBy: { updatedAt: 'desc' }
    });

    res.status(200).json({
      status: joinRequest ? joinRequest.status : 'none',
      isMember: Boolean(isMember),
      joinRequest: joinRequest || null
    });
  } catch (err) {
    console.error('Error fetching request status:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── GET /api/team-join-requests/manager ─────────────────────────────────────
// Fetch join requests for teams where user is Captain, Manager/Coach (or Admin)
export const getManagerRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { teamId } = req.query;

    // 1. Find team IDs where user is Manager/Coach (managerId)
    const managedTeams = await prisma.team.findMany({
      where: { managerId: userId },
      select: { id: true }
    });
    const managedTeamIds = managedTeams.map(t => t.id);

    // 2. Find team IDs where user is Captain (isCaptain = true in team_members)
    const captainMembers = await prisma.teamMember.findMany({
      where: { playerId: userId, isCaptain: true },
      select: { teamId: true }
    });
    const captainTeamIds = captainMembers.map(m => m.teamId).filter(Boolean);

    const allowedTeamIds = Array.from(new Set([...managedTeamIds, ...captainTeamIds]));

    let targetTeamIds = [];

    if (teamId) {
      const isAllowed = allowedTeamIds.includes(teamId) || req.user.role === 'admin';
      if (!isAllowed) {
        return res.status(403).json({
          error: 'Forbidden: Only the team captain, manager, or coach can view team join requests.',
          joinRequests: []
        });
      }
      targetTeamIds = [teamId];
    } else {
      if (req.user.role === 'admin') {
        const allTeams = await prisma.team.findMany({ select: { id: true } });
        targetTeamIds = allTeams.map(t => t.id);
      } else {
        targetTeamIds = allowedTeamIds;
      }
    }

    if (targetTeamIds.length === 0) {
      return res.status(200).json({ joinRequests: [] });
    }

    const joinRequests = await prisma.teamJoinRequest.findMany({
      where: {
        teamId: { in: targetTeamIds }
      },
      include: {
        player: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            preferredPosition: true,
            jerseyNumber: true,
            phone: true,
            bio: true
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true,
            primaryColor: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ joinRequests });
  } catch (err) {
    console.error('Error fetching manager join requests:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── POST /api/team-join-requests/:id/approve ────────────────────────────────
// Approve a join request and add the player to team_members
export const approveJoinRequest = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { id } = req.params;

    const request = await prisma.teamJoinRequest.findUnique({
      where: { id },
      include: { team: true, player: true }
    });

    if (!request) {
      return res.status(404).json({ error: 'Join request not found.' });
    }

    // Verify manager permission (must be manager of the team or admin)
    if (request.team?.managerId !== managerId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Only the team manager can approve join requests.' });
    }

    // Mark request as approved
    const updatedRequest = await prisma.teamJoinRequest.update({
      where: { id },
      data: { status: 'approved', updatedAt: new Date() },
      include: { team: true, player: true }
    });

    // Check if player is already a member of team_members
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_playerId: {
          teamId: request.teamId,
          playerId: request.playerId
        }
      }
    });

    if (!existingMember) {
      // Find taken jersey numbers for this team
      const existingMembers = await prisma.teamMember.findMany({
        where: { teamId: request.teamId },
        select: { jerseyNumber: true }
      });
      const takenJerseys = new Set(existingMembers.map(m => m.jerseyNumber));

      // Pick preferred jersey number or next available number 1..99
      let assignedJersey = request.player?.jerseyNumber;
      if (!assignedJersey || takenJerseys.has(assignedJersey)) {
        assignedJersey = 1;
        while (takenJerseys.has(assignedJersey) && assignedJersey <= 99) {
          assignedJersey++;
        }
      }

      await prisma.teamMember.create({
        data: {
          teamId: request.teamId,
          playerId: request.playerId,
          jerseyNumber: assignedJersey,
          position: request.player?.preferredPosition || 'Midfielder',
          isCaptain: false
        }
      });
    }

    // Notify player that request was approved
    if (request.playerId) {
      await createNotification({
        userId: request.playerId,
        title: 'Team Request Approved',
        message: `Your request to join ${request.team?.name || 'the team'} has been approved!`,
        type: 'success',
        link: `/teams/${request.teamId}`
      });
    }

    res.status(200).json({
      message: 'Team Request Approved',
      joinRequest: updatedRequest
    });
  } catch (err) {
    console.error('Error approving join request:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// ─── POST /api/team-join-requests/:id/reject ─────────────────────────────────
// Reject a join request
export const rejectJoinRequest = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { id } = req.params;

    const request = await prisma.teamJoinRequest.findUnique({
      where: { id },
      include: { team: true, player: true }
    });

    if (!request) {
      return res.status(404).json({ error: 'Join request not found.' });
    }

    // Verify manager permission
    if (request.team?.managerId !== managerId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Only the team manager can reject join requests.' });
    }

    // Mark request as rejected
    const updatedRequest = await prisma.teamJoinRequest.update({
      where: { id },
      data: { status: 'rejected', updatedAt: new Date() },
      include: { team: true, player: true }
    });

    // Notify player that request was rejected
    if (request.playerId) {
      await createNotification({
        userId: request.playerId,
        title: 'Team Request Rejected',
        message: `Your request to join ${request.team?.name || 'the team'} was rejected.`,
        type: 'warning',
        link: `/teams/${request.teamId}`
      });
    }

    res.status(200).json({
      message: 'Team Request Rejected',
      joinRequest: updatedRequest
    });
  } catch (err) {
    console.error('Error rejecting join request:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
