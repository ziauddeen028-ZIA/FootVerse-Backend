import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';

// GET /api/team-members - Get all team members across all teams
export const getAllTeamMembers = async (req, res) => {
  try {
    const callerId = req.user?.id ?? null;
    const callerProfile = callerId
      ? await prisma.profile.findUnique({ where: { id: callerId }, select: { role: true } })
      : null;
    const isAdmin = callerProfile?.role === 'admin';

    const { tournamentId, organizerId, mine } = req.query;
    let whereClause = {};

    if (mine === 'true' && callerId) {
      if (!isAdmin) {
        whereClause.team = { tournament: { organizerId: callerId } };
      }
    } else if (organizerId) {
      whereClause.team = { tournament: { organizerId } };
    }

    if (tournamentId) {
      if (whereClause.team) {
        whereClause.team.tournamentId = tournamentId;
      } else {
        whereClause.team = { tournamentId };
      }
    }

    const members = await prisma.teamMember.findMany({
      where: whereClause,
      include: {
        player: true,
        team: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    });

    res.status(200).json({ teamMembers: members });
  } catch (err) {
    console.error('Error fetching all team members:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// GET /api/team-members/team/:teamId - Get members for a specific team
export const getTeamMembersByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        player: true,
        team: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    });

    res.status(200).json({ teamMembers: members });
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// GET /api/team-members/player/:playerId - Get all team memberships for a specific player
export const getTeamMembersByPlayer = async (req, res) => {
  try {
    const { playerId } = req.params;

    const members = await prisma.teamMember.findMany({
      where: { playerId },
      include: {
        team: {
          include: {
            tournament: {
              select: { id: true, name: true }
            },
            manager: {
              select: { id: true, fullName: true, email: true }
            },
            members: {
              select: { playerId: true, isCaptain: true }
            }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    });

    res.status(200).json({ teamMembers: members });
  } catch (err) {
    console.error('Error fetching player team memberships:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// POST /api/team-members - Create/Add a player to a team
export const addTeamMember = async (req, res) => {
  try {
    const { teamId, playerId, fullName, email, jerseyNumber, position, avatarUrl, bio, isCaptain } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team is required.' });
    }

    if (jerseyNumber === undefined || jerseyNumber === null || jerseyNumber === '') {
      return res.status(400).json({ error: 'Jersey number is required.' });
    }

    const parsedJersey = Number(jerseyNumber);
    if (!Number.isInteger(parsedJersey) || parsedJersey < 1 || parsedJersey > 99) {
      return res.status(400).json({ error: 'Jersey number must be an integer between 1 and 99.' });
    }

    // Verify team exists
    const teamExists = await prisma.team.findUnique({ where: { id: teamId } });
    if (!teamExists) {
      return res.status(404).json({ error: 'Selected team not found.' });
    }

    // Validate duplicate jersey number within the same team
    const existingJersey = await prisma.teamMember.findFirst({
      where: {
        teamId,
        jerseyNumber: parsedJersey
      }
    });

    if (existingJersey) {
      return res.status(400).json({ error: `Jersey #${parsedJersey} is already taken in this team.` });
    }

    // Reuse existing profile or create a new profile if necessary
    let playerProfile = null;

    if (playerId) {
      playerProfile = await prisma.profile.findUnique({ where: { id: playerId } });
    }

    if (!playerProfile && email && email.trim()) {
      playerProfile = await prisma.profile.findUnique({ where: { email: email.trim().toLowerCase() } });
    }

    if (!playerProfile && fullName && fullName.trim()) {
      playerProfile = await prisma.profile.findFirst({
        where: {
          fullName: { equals: fullName.trim(), mode: 'insensitive' }
        }
      });
    }

    // If profile still doesn't exist, create a new one
    if (!playerProfile) {
      const nameToUse = fullName && fullName.trim() ? fullName.trim() : 'Player';
      const emailToUse = email && email.trim()
        ? email.trim().toLowerCase()
        : `player_${Date.now()}_${Math.floor(Math.random() * 1000)}@footverse.local`;

      playerProfile = await prisma.profile.create({
        data: {
          fullName: nameToUse,
          email: emailToUse,
          role: 'player',
          avatarUrl: avatarUrl || null,
          preferredPosition: position || 'Midfielder',
          jerseyNumber: parsedJersey,
          bio: bio || null
        }
      });
    } else {
      // Update profile info if provided
      const updateData = {};
      if (fullName && fullName.trim()) updateData.fullName = fullName.trim();
      if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
      if (bio !== undefined) updateData.bio = bio;

      if (Object.keys(updateData).length > 0) {
        playerProfile = await prisma.profile.update({
          where: { id: playerProfile.id },
          data: updateData
        });
      }
    }

    // Check if player is already in this team
    const existingMembership = await prisma.teamMember.findUnique({
      where: {
        teamId_playerId: {
          teamId,
          playerId: playerProfile.id
        }
      }
    });

    if (existingMembership) {
      return res.status(400).json({ error: 'This player is already a member of this team.' });
    }

    // Enforce only ONE captain per team
    if (Boolean(isCaptain)) {
      const existingCaptain = await prisma.teamMember.findFirst({
        where: { teamId, isCaptain: true }
      });
      if (existingCaptain) {
        return res.status(400).json({ error: 'This team already has a captain. Only one captain per team is allowed.' });
      }
    }

    // Create TeamMember link
    const newMember = await prisma.teamMember.create({
      data: {
        teamId,
        playerId: playerProfile.id,
        jerseyNumber: parsedJersey,
        position: position || 'Midfielder',
        isCaptain: Boolean(isCaptain)
      },
      include: {
        player: true,
        team: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Notify the player that they've been added to a team
    if (playerProfile?.id) {
      await createNotification({
        userId: playerProfile.id,
        title: 'You\'ve joined a team!',
        message: `You have been added to ${newMember.team?.name || 'a team'}. Welcome aboard!`,
        type: 'success',
        link: `/teams/${newMember.teamId}`
      });
    }

    res.status(201).json({ message: 'Team member added!', teamMember: newMember });
  } catch (err) {
    console.error('Error adding team member:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// PUT /api/team-members/:id - Update a team member's details
export const updateTeamMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { teamId, fullName, jerseyNumber, position, avatarUrl, bio, isCaptain } = req.body;

    const existingMember = await prisma.teamMember.findUnique({
      where: { id },
      include: { player: true }
    });

    if (!existingMember) {
      return res.status(404).json({ error: 'Team member not found.' });
    }

    const targetTeamId = teamId || existingMember.teamId;
    const targetJersey = jerseyNumber !== undefined ? Number(jerseyNumber) : existingMember.jerseyNumber;
    const targetIsCaptain = isCaptain !== undefined ? Boolean(isCaptain) : Boolean(existingMember.isCaptain);

    if (!Number.isInteger(targetJersey) || targetJersey < 1 || targetJersey > 99) {
      return res.status(400).json({ error: 'Jersey number must be an integer between 1 and 99.' });
    }

    // Check duplicate jersey number in target team (excluding current member)
    const duplicateJersey = await prisma.teamMember.findFirst({
      where: {
        teamId: targetTeamId,
        jerseyNumber: targetJersey,
        NOT: { id }
      }
    });

    if (duplicateJersey) {
      return res.status(400).json({ error: `Jersey #${targetJersey} is already taken in this team.` });
    }

    // Enforce only ONE captain per team
    if (targetIsCaptain) {
      const existingCaptain = await prisma.teamMember.findFirst({
        where: {
          teamId: targetTeamId,
          isCaptain: true,
          NOT: { id }
        }
      });
      if (existingCaptain) {
        return res.status(400).json({ error: 'This team already has a captain. Only one captain per team is allowed.' });
      }
    }

    // Update Profile details if player exists and updates are provided
    if (existingMember.playerId && (fullName !== undefined || avatarUrl !== undefined || bio !== undefined)) {
      await prisma.profile.update({
        where: { id: existingMember.playerId },
        data: {
          fullName: fullName ? fullName.trim() : existingMember.player?.fullName,
          avatarUrl: avatarUrl !== undefined ? avatarUrl : existingMember.player?.avatarUrl,
          bio: bio !== undefined ? bio : existingMember.player?.bio,
          preferredPosition: position || existingMember.player?.preferredPosition
        }
      });
    }

    // Update TeamMember record
    const updatedMember = await prisma.teamMember.update({
      where: { id },
      data: {
        teamId: targetTeamId,
        jerseyNumber: targetJersey,
        position: position || existingMember.position,
        isCaptain: targetIsCaptain
      },
      include: {
        player: true,
        team: {
          include: {
            tournament: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.status(200).json({ message: 'Team member updated!', teamMember: updatedMember });
  } catch (err) {
    console.error('Error updating team member:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE /api/team-members/:id - Remove a player from a team (does NOT delete Profile)
export const removeTeamMember = async (req, res) => {
  try {
    const { id } = req.params;

    const existingMember = await prisma.teamMember.findUnique({ where: { id } });
    if (!existingMember) {
      return res.status(404).json({ error: 'Team member not found.' });
    }

    // Delete ONLY the TeamMember relationship, keeping the Profile intact for future teams/tournaments
    await prisma.teamMember.delete({ where: { id } });

    res.status(200).json({ message: 'Player removed from team successfully.' });
  } catch (err) {
    console.error('Error removing team member:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
