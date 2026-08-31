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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Supabase client initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder-key';
export const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true
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

app.listen(PORT, () => {
  console.log(`⚽ FootVerse API server listening on http://localhost:${PORT}`);
});
