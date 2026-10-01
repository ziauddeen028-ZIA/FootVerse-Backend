import prisma from '../lib/prisma.js';

/**
 * Round-robin scheduling algorithm.
 * Given N teams, generates (N-1) matchdays where each team plays exactly once per matchday.
 * If N is odd, one team gets a "bye" each matchday (skipped here — odd teams not paired).
 *
 * Uses the "circle method": fix team 0, rotate the rest.
 *
 * @param {Array} teams - Array of team objects with at least { id }
 * @returns {Array<Array<{ home: object, away: object }>>} Array of matchday arrays
 */
const generateRoundRobinSchedule = (teams) => {
  const teamList = [...teams];
  const n = teamList.length;

  // If odd number of teams, add a dummy "bye" team
  const hasBye = n % 2 !== 0;
  if (hasBye) {
    teamList.push({ id: null, name: 'BYE', shortName: 'BYE' });
  }

  const totalTeams = teamList.length;
  const totalMatchdays = totalTeams - 1;
  const matchesPerDay = totalTeams / 2;

  const schedule = [];

  // Fix the first team, rotate the rest
  const fixed = teamList[0];
  const rotating = teamList.slice(1);

  for (let day = 0; day < totalMatchdays; day++) {
    const matchday = [];

    // First match: fixed team vs first in rotation
    const opponent = rotating[0];
    if (fixed.id !== null && opponent.id !== null) {
      // Alternate home/away for the fixed team
      if (day % 2 === 0) {
        matchday.push({ home: fixed, away: opponent });
      } else {
        matchday.push({ home: opponent, away: fixed });
      }
    }

    // Remaining pairs: pair from outside in
    for (let i = 1; i < matchesPerDay; i++) {
      const home = rotating[i];
      const away = rotating[totalTeams - 1 - i];

      if (home.id !== null && away.id !== null) {
        matchday.push({ home, away });
      }
    }

    schedule.push(matchday);

    // Rotate: move last element to front
    rotating.push(rotating.shift());
  }

  return schedule;
};

/**
 * POST /api/tournaments/:tournamentId/league/generate
 * Generates all round-robin league fixtures for a pure league tournament.
 */
export const generateLeagueFixtures = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const userId = req.user.id;

    // 1. Verify tournament exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, format: true, startDate: true, organizerId: true, status: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    // 2. Validate format is league
    const isLeague = tournament.format === 'league' || tournament.format === 'round_robin';
    if (!isLeague) {
      return res.status(400).json({ error: 'Tournament format must be "league" to generate league fixtures.' });
    }

    // 3. Verify authorization
    const user = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true }
    });

    if (!user || (tournament.organizerId !== userId && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only the tournament organizer or an admin can generate league fixtures.' });
    }

    // 4. Fetch registered teams
    const teams = await prisma.team.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, shortName: true, logoUrl: true }
    });

    if (!teams || teams.length < 2) {
      return res.status(400).json({
        error: `At least 2 teams are required to generate league fixtures. Current team count: ${teams?.length || 0}.`
      });
    }

    // 5. Check if non-bracket fixtures already exist for this tournament
    const existingMatch = await prisma.match.findFirst({
      where: {
        tournamentId,
        bracketPosition: null
      }
    });

    if (existingMatch) {
      return res.status(400).json({
        error: 'League fixtures have already been generated for this tournament.'
      });
    }

    const baseDate = tournament.startDate && !isNaN(new Date(tournament.startDate).getTime())
      ? new Date(tournament.startDate)
      : new Date();

    // 6. Generate single-division round-robin schedule
    const schedule = generateRoundRobinSchedule(teams);

    const createdMatches = await prisma.$transaction(async (tx) => {
      const allMatches = [];

      for (let dayIndex = 0; dayIndex < schedule.length; dayIndex++) {
        const matchday = schedule[dayIndex];
        const roundName = `Matchday ${dayIndex + 1}`;
        // Each matchday is spaced 7 days apart
        const matchdayDate = new Date(baseDate.getTime() + dayIndex * 7 * 24 * 60 * 60 * 1000);

        for (let mIndex = 0; mIndex < matchday.length; mIndex++) {
          const { home, away } = matchday[mIndex];
          // Stagger match times within a matchday (2 hours apart)
          const matchDate = new Date(matchdayDate.getTime() + mIndex * 2 * 60 * 60 * 1000);

          const match = await tx.match.create({
            data: {
              tournamentId,
              homeTeamId: home.id,
              awayTeamId: away.id,
              roundName,
              matchDate,
              status: 'scheduled'
            },
            include: {
              homeTeam: {
                select: { id: true, name: true, shortName: true, logoUrl: true }
              },
              awayTeam: {
                select: { id: true, name: true, shortName: true, logoUrl: true }
              }
            }
          });

          allMatches.push(match);
        }
      }

      // Update tournament status to ongoing if draft/registration_open
      if (tournament.status === 'draft' || tournament.status === 'registration_open') {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: 'ongoing' }
        });
      }

      return allMatches;
    });

    // Group generated matches by matchday
    const fixtures = {};
    for (const match of createdMatches) {
      const day = match.roundName;
      if (!fixtures[day]) fixtures[day] = [];
      fixtures[day].push(match);
    }

    return res.status(201).json({
      message: 'League fixtures generated successfully.',
      tournament: {
        id: tournament.id,
        name: tournament.name
      },
      totalMatchdays: schedule.length,
      totalMatches: createdMatches.length,
      fixtures
    });

  } catch (err) {
    console.error('Error generating league fixtures:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * POST /api/tournaments/:tournamentId/group-stage/generate
 * Generates round-robin fixtures strictly within each group for group_stage / group_knockout tournaments.
 */
export const generateGroupStageFixtures = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const userId = req.user.id;

    // 1. Verify tournament exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, format: true, startDate: true, organizerId: true, status: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    // 2. Validate format is group stage / group knockout
    const isGroupStage = tournament.format === 'group_stage' || 
                         tournament.format === 'group_knockout' || 
                         tournament.format === 'hybrid';

    if (!isGroupStage) {
      return res.status(400).json({
        error: `Tournament format must be "group_stage" or "group_knockout" to generate group fixtures. Got: "${tournament.format}".`
      });
    }

    // 3. Verify authorization
    const user = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, role: true }
    });

    if (!user || (tournament.organizerId !== userId && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Only the tournament organizer or an admin can generate group fixtures.' });
    }

    // 4. Fetch registered teams
    const teams = await prisma.team.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, shortName: true, logoUrl: true, groupName: true }
    });

    if (!teams || teams.length < 2) {
      return res.status(400).json({
        error: `At least 2 teams are required to generate group fixtures. Current team count: ${teams?.length || 0}.`
      });
    }

    // 5. Check if non-bracket fixtures already exist for this tournament
    const existingMatch = await prisma.match.findFirst({
      where: {
        tournamentId,
        bracketPosition: null
      }
    });

    if (existingMatch) {
      return res.status(400).json({
        error: 'Group stage fixtures have already been generated for this tournament.'
      });
    }

    // 6. Validate all registered teams have a groupName
    const missingGroup = teams.some(t => !t.groupName || t.groupName.trim() === '');
    if (missingGroup) {
      return res.status(400).json({
        error: 'All registered teams must be assigned to a group (groupName) before generating group stage fixtures.'
      });
    }

    // 7. Group teams by groupName
    const groupsMap = {};
    teams.forEach(t => {
      const g = t.groupName.trim();
      if (!groupsMap[g]) groupsMap[g] = [];
      groupsMap[g].push(t);
    });

    // Ensure each group has at least 2 teams
    for (const [gName, gTeams] of Object.entries(groupsMap)) {
      if (gTeams.length < 2) {
        return res.status(400).json({
          error: `${gName} has only ${gTeams.length} team(s). Each group must have at least 2 teams to generate fixtures.`
        });
      }
    }

    const sortedGroupNames = Object.keys(groupsMap).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    const baseDate = tournament.startDate && !isNaN(new Date(tournament.startDate).getTime())
      ? new Date(tournament.startDate)
      : new Date();

    // 8. Create all group matches in a single transaction (fixtures only between teams in the SAME group)
    const createdMatches = await prisma.$transaction(async (tx) => {
      const allMatches = [];

      for (let gIdx = 0; gIdx < sortedGroupNames.length; gIdx++) {
        const gName = sortedGroupNames[gIdx];
        const groupTeams = groupsMap[gName];
        const groupSchedule = generateRoundRobinSchedule(groupTeams);

        for (let dayIndex = 0; dayIndex < groupSchedule.length; dayIndex++) {
          const matchday = groupSchedule[dayIndex];
          const roundName = `${gName} - Matchday ${dayIndex + 1}`;
          // Space matchdays
          const matchdayDate = new Date(baseDate.getTime() + dayIndex * 7 * 24 * 60 * 60 * 1000);

          for (let mIndex = 0; mIndex < matchday.length; mIndex++) {
            const { home, away } = matchday[mIndex];
            // Offset match times within day
            const matchDate = new Date(matchdayDate.getTime() + (gIdx * 2 + mIndex) * 2 * 60 * 60 * 1000);

            const match = await tx.match.create({
              data: {
                tournamentId,
                homeTeamId: home.id,
                awayTeamId: away.id,
                roundName,
                matchDate,
                status: 'scheduled'
              },
              include: {
                homeTeam: {
                  select: { id: true, name: true, shortName: true, logoUrl: true, groupName: true }
                },
                awayTeam: {
                  select: { id: true, name: true, shortName: true, logoUrl: true, groupName: true }
                }
              }
            });

            allMatches.push(match);
          }
        }
      }

      // Update tournament status to ongoing if draft/registration_open
      if (tournament.status === 'draft' || tournament.status === 'registration_open') {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: 'ongoing' }
        });
      }

      return allMatches;
    });

    // Group generated matches by group & matchday
    const fixtures = {};
    for (const match of createdMatches) {
      const day = match.roundName;
      if (!fixtures[day]) fixtures[day] = [];
      fixtures[day].push(match);
    }

    return res.status(201).json({
      message: 'Group stage fixtures generated successfully.',
      tournament: {
        id: tournament.id,
        name: tournament.name
      },
      totalGroups: sortedGroupNames.length,
      totalMatches: createdMatches.length,
      fixtures
    });

  } catch (err) {
    console.error('Error generating group stage fixtures:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
