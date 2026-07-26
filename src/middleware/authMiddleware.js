import { supabase } from '../../server.js';

export const requireAuth = async (req, res, next) => {
  try {
    // 1. Look for the "badge" in the headers
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
    }

    // 2. Extract just the token part (remove "Bearer ")
    const token = authHeader.split(' ')[1];

    // 3. Ask Supabase to verify the token and get the user
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }

    // 4. Success! Attach the user object to the request
    // This allows subsequent routes to know exactly who is making the request
    req.user = data.user;
    
    // 5. Open the door! (Move to the actual route logic)
    next();

  } catch (err) {
    console.error('Auth Middleware Error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
