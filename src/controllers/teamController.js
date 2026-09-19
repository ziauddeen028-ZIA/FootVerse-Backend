import prisma from '../lib/prisma.js';
import { createNotification } from './notificationController.js';

// CREATE a new team
export const createTeam = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { name, shortName, tournamentId, logoUrl, primaryColor, secondaryColor, city, homeGround } = req.body;

    if (!name || !shortName) {
      return res.status(400).json({ error: 'Team name and short name are required.' });
    }

    if (shortName.trim().length > 5) {
      return res.status(400).json({ error: 'Short name must be 5 characters or fewer.' });
    }

    // Check user role from profile or metadata
    const userProfile = await prisma.profile.findUnique({ where: { id: managerId } });
    const userRole = userProfile?.role || req.user.user_metadata?.role || 'player';
    const isOrganizerOrAdmin = userRole === 'organizer' || userRole === 'admin';

    // Organizer/Admin must select a tournament
    if (isOrganizerOrAdmin && !tournamentId) {
      return res.status(400).json({ error: 'Tournament selection is required when creating a team as an organizer or admin.' });
    }

    const targetTournamentId = tournamentId || null;

    if (targetTournamentId) {
      // Verify tournament exists
      const tournamentExists = await prisma.tournament.findUnique({
        where: { id: targetTournamentId }
      });
      if (!tournamentExists) {
        return res.status(404).json({ error: 'Selected tournament not found.' });
      }

      // Check if tournament is full
      const currentTeamCount = await prisma.team.count({
        where: { tournamentId: targetTournamentId }
      });
      if (tournamentExists.maxTeams !== null && currentTeamCount >= tournamentExists.maxTeams) {
        return res.status(400).json({ error: 'Tournament is full. No more teams can be registered.' });
      }

      // Check duplicate team name within the same tournament
      const existingTeam = await prisma.team.findFirst({
        where: {
          tournamentId: targetTournamentId,
          name: { equals: name.trim(), mode: 'insensitive' }
        }
      });

      if (existingTeam) {
        return res.status(400).json({ error: 'A team with this name already exists in the selected tournament.' });
      }
    } else {
      // Check duplicate team name for the same manager when not assigned to a tournament
      const existingTeam = await prisma.team.findFirst({
        where: {
          managerId,
          name: { equals: name.trim(), mode: 'insensitive' }
        }
      });

      if (existingTeam) {
        return res.status(400).json({ error: 'You already have a team with this name.' });
      }
    }

    const newTeam = await prisma.team.create({
      data: {
        name: name.trim(),
        shortName: shortName.trim().toUpperCase(),
        tournamentId: targetTournamentId,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || '#1E50FF',
        secondaryColor: secondaryColor || '#FFFFFF',
        city: city || null,
        homeGround: homeGround || null,
        managerId
      },
      include: {
        tournament: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Automatically make creator the team's Captain in team_members if not already added
    const existingCaptainMember = await prisma.teamMember.findFirst({
      where: { teamId: newTeam.id, playerId: managerId }
    });

    if (!existingCaptainMember) {
      await prisma.teamMember.create({
        data: {
          teamId: newTeam.id,
          playerId: managerId,
          jerseyNumber: 10,
          position: userProfile?.preferredPosition || 'Captain',
          isCaptain: true
        }
      });
    }

    // Notify the manager/captain that their team was created
    await createNotification({
      userId: managerId,
      title: 'Team Created!',
      message: newTeam.tournament?.name
        ? `Your team "${newTeam.name}" has been registered for "${newTeam.tournament.name}" successfully.`
        : `Your team "${newTeam.name}" has been created successfully.`,
      type: 'success',
      link: `/teams/${newTeam.id}`
    });

    res.status(201).json({ message: 'Team created!', team: newTeam });
  } catch (err) {
    console.error('Error creating team:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ all teams (Public)
export const getAllTeams = async (req, res) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        tournament: {
          select: {
            id: true,
            name: true
          }
        },
        members: {
          select: {
            playerId: true,
            isCaptain: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ teams });
  } catch (err) {
    console.error('Error fetching teams:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// READ a single team by ID (Public)
export const getTeamById = async (req, res) => {
  try {
    const { id } = req.params;

    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        tournament: {
          select: {
            id: true,
            name: true
          }
        },
        manager: {
          select: {
            fullName: true,
            email: true
          }
        }
      }
    });

    if (!team) return res.status(404).json({ error: 'Team not found.' });

    res.status(200).json({ team });
  } catch (err) {
    console.error('Error fetching team:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// UPDATE a team
export const updateTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    // Check if team exists
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: 'Team not found.' });

    // Check if user is manager or organizer/admin
    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (team.managerId !== userId && user?.role !== 'organizer' && user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only team manager, organizer, or admin can update this team.' });
    }

    const targetTournamentId = updateData.tournamentId || team.tournamentId;
    const targetName = updateData.name ? updateData.name.trim() : team.name;

    if (updateData.shortName && updateData.shortName.trim().length > 5) {
      return res.status(400).json({ error: 'Short name must be 5 characters or fewer.' });
    }

    // If tournament is being changed, check capacity of the target tournament
    const isTournamentChanging = updateData.tournamentId && updateData.tournamentId !== team.tournamentId;
    if (isTournamentChanging) {
      const targetTournament = await prisma.tournament.findUnique({
        where: { id: targetTournamentId }
      });
      if (!targetTournament) {
        return res.status(404).json({ error: 'Target tournament not found.' });
      }
      if (targetTournament.maxTeams !== null) {
        const countInTarget = await prisma.team.count({
          where: { tournamentId: targetTournamentId }
        });
        if (countInTarget >= targetTournament.maxTeams) {
          return res.status(400).json({ error: 'Tournament is full. No more teams can be registered.' });
        }
      }
    }

    if (targetTournamentId && targetName) {
      const duplicateTeam = await prisma.team.findFirst({
        where: {
          tournamentId: targetTournamentId,
          name: { equals: targetName, mode: 'insensitive' },
          NOT: { id }
        }
      });

      if (duplicateTeam) {
        return res.status(400).json({ error: 'A team with this name already exists in the selected tournament.' });
      }
    }

    const updatedTeam = await prisma.team.update({
      where: { id },
      data: {
        name: targetName,
        shortName: updateData.shortName ? updateData.shortName.trim().toUpperCase() : team.shortName,
        tournamentId: targetTournamentId,
        logoUrl: updateData.logoUrl !== undefined ? updateData.logoUrl : team.logoUrl,
        primaryColor: updateData.primaryColor !== undefined ? updateData.primaryColor : team.primaryColor,
        secondaryColor: updateData.secondaryColor !== undefined ? updateData.secondaryColor : team.secondaryColor,
        city: updateData.city !== undefined ? updateData.city : team.city,
        homeGround: updateData.homeGround !== undefined ? updateData.homeGround : team.homeGround,
        groupName: updateData.groupName !== undefined ? updateData.groupName : team.groupName
      },
      include: {
        tournament: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(200).json({ message: 'Team updated!', team: updatedTeam });
  } catch (err) {
    console.error('Error updating team:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE a team
export const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: 'Team not found.' });

    const user = await prisma.profile.findUnique({ where: { id: userId } });
    if (team.managerId !== userId && user?.role !== 'organizer' && user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only team manager, organizer, or admin can delete this team.' });
    }

    await prisma.team.delete({ where: { id } });

    res.status(200).json({ message: 'Team deleted successfully.' });
  } catch (err) {
    console.error('Error deleting team:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
