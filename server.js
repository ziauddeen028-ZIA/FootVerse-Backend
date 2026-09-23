import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Route Imports
import authRoutes from './src/routes/authRoutes.js';
import profileRoutes from './src/routes/profileRoutes.js';
import teamRoutes from './src/routes/teamRoutes.js';
import tournamentRoutes from './src/routes/tournamentRoutes.js';
import matchRoutes from './src/routes/matchRoutes.js';
import statsRoutes from './src/routes/statsRoutes.js';
import teamMemberRoutes from './src/routes/teamMemberRoutes.js';
import matchEventRoutes from './src/routes/matchEventRoutes.js';
import standingsRoutes from './src/routes/standingsRoutes.js';
import knockoutRoutes from './src/routes/knockoutRoutes.js';
import leagueRoutes from './src/routes/leagueRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import teamJoinRequestRoutes from './src/routes/teamJoinRequestRoutes.js';
import tournamentJoinRequestRoutes from './src/routes/tournamentJoinRequestRoutes.js';
import prisma from './src/lib/prisma.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Supabase client initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder-key';
export const supabase = createClient(supabaseUrl, supabaseKey);

// Warm up Prisma database connection on server startup to eliminate cold-start lag
prisma.$connect()
  .then(() => {
    console.log('✅ Database connected successfully via Prisma');
  })
  .catch((err) => {
    console.error('❌ Database connection warning on startup:', err.message || err);
  });

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.CLIENT_ORIGIN
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// Setup API Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/team-members', teamMemberRoutes);
app.use('/api/match-events', matchEventRoutes);
app.use('/api/tournaments', standingsRoutes);
app.use('/api/tournaments', knockoutRoutes);
app.use('/api/tournaments', leagueRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/team-join-requests', teamJoinRequestRoutes);
app.use('/api/tournament-join-requests', tournamentJoinRequestRoutes);

// Health Check API Endpoint
app.get('/api/health', (req, res) => {
  const isSupabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  res.json({
    status: 'online',
    service: 'FootVerse Backend Engine',
    version: '1.0.0',
    supabaseConnected: isSupabaseConfigured,
    timestamp: new Date().toISOString()
  });
});

// Roles metadata endpoint
app.get('/api/roles', (req, res) => {
  res.json({
    roles: [
      { id: 'guest', name: 'Guest', description: 'Public view mode, discover tournaments & stats' },
      { id: 'player', name: 'Player', description: 'Join teams, view match history & personal stats' },
      { id: 'team_manager', name: 'Team Manager', description: 'Create and manage squad, register for tournaments' },
      { id: 'organizer', name: 'Organizer', description: 'Host tournaments, schedule fixtures, update live scores' },
      { id: 'admin', name: 'Platform Admin', description: 'Full system management, user role control & verification' }
    ]
  });
});

app.listen(PORT, HOST, () => {
  console.log(`⚽ FootVerse API server listening on http://${HOST}:${PORT} (http://localhost:${PORT})`);
});
