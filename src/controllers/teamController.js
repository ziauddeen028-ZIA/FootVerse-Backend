import prisma from '../lib/prisma.js';

// CREATE a new team
export const createTeam = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { name, shortName, logoUrl, primaryColor, secondaryColor, city, homeGround } = req.body;

    if (!name || !shortName) {
      return res.status(400).json({ error: 'Team name and short name are required.' });
    }

    const newTeam = await prisma.teams.create({
      data: {
        name,
        short_name: shortName,
        logo_url: logoUrl,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        city,
        home_ground: homeGround,
        manager_id: managerId
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
    const teams = await prisma.teams.findMany();
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
    const team = await prisma.teams.findUnique({
      where: { id },
      include: {
        profiles: {
          select: {
            full_name: true,
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

    // First, check if the team exists and if the user is the manager
    const team = await prisma.teams.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    if (team.manager_id !== userId) return res.status(403).json({ error: 'Only the manager can update this team.' });

    const updatedTeam = await prisma.teams.update({
      where: { id },
      data: {
        name: updateData.name,
        short_name: updateData.shortName,
        logo_url: updateData.logoUrl,
        primary_color: updateData.primaryColor,
        secondary_color: updateData.secondaryColor,
        city: updateData.city,
        home_ground: updateData.homeGround
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

    // Check ownership
    const team = await prisma.teams.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    if (team.manager_id !== userId) return res.status(403).json({ error: 'Only the manager can delete this team.' });

    await prisma.teams.delete({ where: { id } });

    res.status(200).json({ message: 'Team deleted successfully.' });
  } catch (err) {
    console.error('Error deleting team:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
