import prisma from '../lib/prisma.js';

// CREATE a new team
export const createTeam = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { name, shortName, logoUrl, primaryColor, secondaryColor, city, homeGround } = req.body;

    if (!name || !shortName) {
      return res.status(400).json({ error: 'Team name and short name are required.' });
    }

    const newTeam = await prisma.team.create({
      data: {
        name,
        shortName,
        logoUrl,
        primaryColor,
        secondaryColor,
        city,
        homeGround,
        managerId // The logged-in user becomes the manager!
      }
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
    const teams = await prisma.team.findMany();
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
    
    // We can also ask Prisma to "include" the manager's profile!
    const team = await prisma.team.findUnique({
      where: { id },
      include: { manager: { select: { fullName: true, email: true } } }
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

    // First, check if the team exists and if the user is the manager
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    if (team.managerId !== userId) return res.status(403).json({ error: 'Only the manager can update this team.' });

    const updatedTeam = await prisma.team.update({
      where: { id },
      data: updateData
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

    // Check ownership
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    if (team.managerId !== userId) return res.status(403).json({ error: 'Only the manager can delete this team.' });

    await prisma.team.delete({ where: { id } });

    res.status(200).json({ message: 'Team deleted successfully.' });
  } catch (err) {
    console.error('Error deleting team:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
