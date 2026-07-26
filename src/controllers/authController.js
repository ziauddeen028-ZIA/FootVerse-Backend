import { supabase } from '../../server.js';

export const registerUser = async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body;

    // Validate basic input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // 1. Ask Supabase to create the user
    // We pass fullName and role as metadata so our SQL trigger can use them
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role || 'player'
        }
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Success! 
    res.status(201).json({
      message: 'User registered successfully!',
      user: data.user,
      session: data.session
    });

  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// Login an existing user
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Ask Supabase to verify the credentials
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    // Success! Return user info and the session token (JWT)
    res.status(200).json({
      message: 'Login successful!',
      user: data.user,
      session: data.session
    });

  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
