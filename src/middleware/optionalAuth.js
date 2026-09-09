import { supabase } from '../../server.js';

/**
 * Optional authentication middleware.
 * If an Authorization Bearer token is provided and valid, attaches req.user.
 * If missing or invalid, leaves req.user = null and allows the request to continue.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      req.user = null;
      return next();
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      req.user = null;
      return next();
    }

    req.user = data.user;
    next();
  } catch (err) {
    // If auth verification throws, proceed as unauthenticated without crashing
    req.user = null;
    next();
  }
};
