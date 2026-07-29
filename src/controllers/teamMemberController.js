import prisma from '../lib/prisma.js';

// POST /api/team-members
export const addTeamMember = async (req, res) => {
  try {
    const { teamId, playerId, jerseyNumber, position, isCaptain } = req.body;

    if (!teamId || !playerId) {
      return res.status(400).json({ error: 'teamId and playerId are required.' });
    }

    const newMember = await prisma.teamMember.create({
      data: {
        teamId,
        playerId,
        jerseyNumber,
        position,
        isCaptain
      }
    });
    
    res.status(201).json({ message: 'Team member added!', teamMember: newMember });
  } catch (err) {
    console.error('Error adding team member:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// GET /api/team-members/team/:teamId
export const getTeamMembersByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        player: {
          select: {
            fullName: true,
            email: true,
            avatarUrl: true
          }
        }
      }
    });

    res.status(200).json({ teamMembers: members });
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// PUT /api/team-members/:id
export const updateTeamMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { jerseyNumber, position, isCaptain } = req.body;

    const existingMember = await prisma.teamMember.findUnique({ where: { id } });
    if (!existingMember) return res.status(404).json({ error: 'Team member not found.' });

    const updatedMember = await prisma.teamMember.update({
      where: { id },
      data: {
        jerseyNumber,
        position,
        isCaptain
      }
    });

    res.status(200).json({ message: 'Team member updated!', teamMember: updatedMember });
  } catch (err) {
    console.error('Error updating team member:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// DELETE /api/team-members/:id
export const removeTeamMember = async (req, res) => {
  try {
    const { id } = req.params;

    const existingMember = await prisma.teamMember.findUnique({ where: { id } });
    if (!existingMember) return res.status(404).json({ error: 'Team member not found.' });

    await prisma.teamMember.delete({ where: { id } });

    res.status(200).json({ message: 'Team member removed successfully.' });
  } catch (err) {
    console.error('Error removing team member:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
