import prisma from '../lib/prisma.js';

// Get the current user's profile
export const getProfile = async (req, res) => {
  try {
    // req.user.id is securely provided by our requireAuth middleware
    const userId = req.user.id;

    // Ask Prisma (the Librarian) to find the profile
    const profile = await prisma.profile.findUnique({
      where: { id: userId }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    res.status(200).json({ profile });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// Update the current user's profile
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fullName, phone, preferredPosition, jerseyNumber, bio } = req.body;

    // Ask Prisma to update this specific user's record
    const updatedProfile = await prisma.profile.update({
      where: { id: userId },
      data: {
        fullName,
        phone,
        preferredPosition,
        jerseyNumber,
        bio
      }
    });

    res.status(200).json({
      message: 'Profile updated successfully!',
      profile: updatedProfile
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
