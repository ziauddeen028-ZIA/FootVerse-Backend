import prisma from '../lib/prisma.js';

/**
 * Calculates group standings given teams and completed matches.
 * @param {Array} teams - List of team objects with id, name, shortName, logoUrl, groupName
 * @param {Array} matches - List of completed match objects with homeTeamId, awayTeamId, homeScore, awayScore
 * @returns {Array} List of group standings objects [{ name: groupName, standings: [...] }, ...]
 */
export const calculateGroupStandings = (teams, matches) => {
  const standingsMap = {};

  for (const team of teams) {
    standingsMap[team.id] = {
      team: {
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        logoUrl: team.logoUrl,
        groupName: team.groupName || null
      },
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0
    };
  }

  // Accumulate stats from each completed match
  for (const match of matches) {
    const homeId = match.homeTeamId;
    const awayId = match.awayTeamId;
    const homeScore = match.homeScore ?? 0;
    const awayScore = match.awayScore ?? 0;

    // Process home team (only if it belongs to this tournament)
    if (standingsMap[homeId]) {
      standingsMap[homeId].played += 1;
      standingsMap[homeId].goalsFor += homeScore;
      standingsMap[homeId].goalsAgainst += awayScore;

      if (homeScore > awayScore) {
        standingsMap[homeId].won += 1;
        standingsMap[homeId].points += 3;
      } else if (homeScore === awayScore) {
        standingsMap[homeId].drawn += 1;
        standingsMap[homeId].points += 1;
      } else {
        standingsMap[homeId].lost += 1;
      }
    }

    // Process away team (only if it belongs to this tournament)
    if (standingsMap[awayId]) {
      standingsMap[awayId].played += 1;
      standingsMap[awayId].goalsFor += awayScore;
      standingsMap[awayId].goalsAgainst += homeScore;

      if (awayScore > homeScore) {
        standingsMap[awayId].won += 1;
        standingsMap[awayId].points += 3;
      } else if (awayScore === homeScore) {
        standingsMap[awayId].drawn += 1;
        standingsMap[awayId].points += 1;
      } else {
        standingsMap[awayId].lost += 1;
      }
    }
  }

  // Compute goal difference for each team
  for (const entry of Object.values(standingsMap)) {
    entry.goalDifference = entry.goalsFor - entry.goalsAgainst;
  }

  // Helper sort function for standings:
  // 1. Points DESC
  // 2. Goal Difference DESC
  // 3. Goals For DESC
  // 4. Wins DESC
  // 5. Team name ASC
  const sortStandings = (list) => {
    return list.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      if (b.won !== a.won) return b.won - a.won;
      return a.team.name.localeCompare(b.team.name);
    });
  };

  // Group teams by groupName
  const groupsMap = {};

  for (const entry of Object.values(standingsMap)) {
    const groupName = entry.team.groupName && entry.team.groupName.trim() !== ''
      ? entry.team.groupName.trim()
      : 'Unassigned';

    if (!groupsMap[groupName]) {
      groupsMap[groupName] = [];
    }
    groupsMap[groupName].push(entry);
  }

  // Build array of groups sorted by group name ASC
  const groups = Object.keys(groupsMap)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(groupName => {
      const sortedGroupStandings = sortStandings(groupsMap[groupName]).map((entry, index) => ({
        position: index + 1,
        ...entry
      }));

      return {
        name: groupName,
        standings: sortedGroupStandings
      };
    });

  return groups;
};

// GET /api/tournaments/:tournamentId/standings
export const getTournamentStandings = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Verify tournament exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }

    // Fetch all teams registered in this tournament
    const teams = await prisma.team.findMany({
      where: { tournamentId },
      select: {
        id: true,
        name: true,
        shortName: true,
        logoUrl: true,
        groupName: true
      }
    });

    // Fetch only fulltime matches for this tournament
    const matches = await prisma.match.findMany({
      where: {
        tournamentId,
        status: 'fulltime'
      },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true
      }
    });

    // Check if any team has a groupName assigned
    const hasGroups = teams.some(t => t.groupName && t.groupName.trim() !== '');

    if (hasGroups) {
      const groups = calculateGroupStandings(teams, matches);
      return res.status(200).json({
        tournament: { id: tournament.id, name: tournament.name },
        groups
      });
    }

    // Default League Standings Response (no groupName values)
    // Build a standings map keyed by teamId for league standings
    const standingsMap = {};

    for (const team of teams) {
      standingsMap[team.id] = {
        team: {
          id: team.id,
          name: team.name,
          shortName: team.shortName,
          logoUrl: team.logoUrl,
          groupName: team.groupName || null
        },
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0
      };
    }

    for (const match of matches) {
      const homeId = match.homeTeamId;
      const awayId = match.awayTeamId;
      const homeScore = match.homeScore ?? 0;
      const awayScore = match.awayScore ?? 0;

      if (standingsMap[homeId]) {
        standingsMap[homeId].played += 1;
        standingsMap[homeId].goalsFor += homeScore;
        standingsMap[homeId].goalsAgainst += awayScore;

        if (homeScore > awayScore) {
          standingsMap[homeId].won += 1;
          standingsMap[homeId].points += 3;
        } else if (homeScore === awayScore) {
          standingsMap[homeId].drawn += 1;
          standingsMap[homeId].points += 1;
        } else {
          standingsMap[homeId].lost += 1;
        }
      }

      if (standingsMap[awayId]) {
        standingsMap[awayId].played += 1;
        standingsMap[awayId].goalsFor += awayScore;
        standingsMap[awayId].goalsAgainst += homeScore;

        if (awayScore > homeScore) {
          standingsMap[awayId].won += 1;
          standingsMap[awayId].points += 3;
        } else if (awayScore === homeScore) {
          standingsMap[awayId].drawn += 1;
          standingsMap[awayId].points += 1;
        } else {
          standingsMap[awayId].lost += 1;
        }
      }
    }

    for (const entry of Object.values(standingsMap)) {
      entry.goalDifference = entry.goalsFor - entry.goalsAgainst;
    }

    const standings = Object.values(standingsMap).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      if (b.won !== a.won) return b.won - a.won;
      return a.team.name.localeCompare(b.team.name);
    });

    const rankedStandings = standings.map((entry, index) => ({
      position: index + 1,
      ...entry
    }));

    res.status(200).json({
      tournament: { id: tournament.id, name: tournament.name },
      standings: rankedStandings
    });
  } catch (err) {
    console.error('Error fetching tournament standings:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

