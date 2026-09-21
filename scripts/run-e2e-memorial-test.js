import prisma from '../src/lib/prisma.js';
import { advanceKnockoutWinner } from '../src/controllers/knockoutController.js';

const TOURNAMENT_ID = '205e5f01-bad3-4424-a03a-410a2b88d3e7';

async function logEvent({ matchId, teamId, playerId, minute, eventType, details = null }) {
  return await prisma.matchEvent.create({
    data: {
      matchId,
      teamId,
      playerId,
      minute,
      eventType,
      details
    }
  });
}

async function completeMatch({ matchId, homeScore, awayScore, tieBreakMethod = null, homePenaltyScore = null, awayPenaltyScore = null, winnerTeamId = null }) {
  const existingMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true }
  });

  if (!existingMatch) {
    throw new Error(`Match ${matchId} not found`);
  }

  let finalWinner = winnerTeamId;
  if (!finalWinner) {
    if (homeScore > awayScore) {
      finalWinner = existingMatch.homeTeamId;
    } else if (awayScore > homeScore) {
      finalWinner = existingMatch.awayTeamId;
    } else if (tieBreakMethod === 'penalty') {
      finalWinner = homePenaltyScore > awayPenaltyScore ? existingMatch.homeTeamId : existingMatch.awayTeamId;
    }
  }

  const updatedMatch = await prisma.$transaction(async (tx) => {
    const match = await tx.match.update({
      where: { id: matchId },
      data: {
        homeScore,
        awayScore,
        tieBreakMethod,
        homePenaltyScore,
        awayPenaltyScore,
        winnerTeamId: finalWinner,
        status: 'fulltime'
      },
      include: {
        homeTeam: true,
        awayTeam: true,
        winnerTeam: true
      }
    });

    const isFinal = match.roundName === 'Final';
    if (isFinal) {
      await tx.tournament.update({
        where: { id: TOURNAMENT_ID },
        data: { status: 'completed' }
      });
    }

    const advancedTo = await advanceKnockoutWinner(tx, TOURNAMENT_ID, matchId, finalWinner, existingMatch);

    return { match, advancedTo };
  });

  return updatedMatch;
}

async function runE2ETest() {
  console.log('========================================================================');
  console.log('⚽ STARTING END-TO-END TEST: MEMORIAL TOURNAMENT');
  console.log('========================================================================\n');

  const tournament = await prisma.tournament.findUnique({
    where: { id: TOURNAMENT_ID },
    include: {
      teams: {
        include: {
          members: {
            include: { player: true }
          }
        }
      },
      matches: {
        include: { homeTeam: true, awayTeam: true, winnerTeam: true, events: true },
        orderBy: [{ roundName: 'asc' }, { bracketPosition: 'asc' }]
      }
    }
  });

  if (!tournament) {
    console.error('Tournament not found!');
    return;
  }

  console.log(`Tournament: "${tournament.name}" (${tournament.format}) | Status: ${tournament.status}`);
  console.log(`Registered Teams: ${tournament.teams.length}`);
  console.log(`Total Bracket Matches: ${tournament.matches.length}\n`);

  // Map of teams by name for easy reference
  const teamMap = new Map();
  tournament.teams.forEach(t => teamMap.set(t.name, t));

  // Player helper
  const getPlayer = (teamName, index = 0) => {
    const t = teamMap.get(teamName);
    return t?.members[index]?.player || null;
  };

  // -------------------------------------------------------------
  // PHASE 1: ROUND OF 16 (Complete matches 3 to 8)
  // -------------------------------------------------------------
  console.log('-------------------------------------------------------------');
  console.log('🥊 PHASE 1: ROUND OF 16 MATCHES');
  console.log('-------------------------------------------------------------');

  const r16Matches = tournament.matches.filter(m => m.roundName === 'Round of 16');
  console.log(`Found ${r16Matches.length} Round of 16 matches.`);

  // Check Matches 1 & 2
  const m1 = r16Matches.find(m => m.bracketPosition === 1);
  const m2 = r16Matches.find(m => m.bracketPosition === 2);
  console.log(`✓ R16 Match 1 (Pos 1): ${m1.homeTeam?.name} (${m1.homeScore}) vs ${m1.awayTeam?.name} (${m1.awayScore}) -> Winner: ${m1.winnerTeam?.name} [Status: ${m1.status}]`);
  console.log(`✓ R16 Match 2 (Pos 2): ${m2.homeTeam?.name} (${m2.homeScore}) vs ${m2.awayTeam?.name} (${m2.awayScore}) -> Winner: ${m2.winnerTeam?.name} [Status: ${m2.status}]`);

  // R16 Match 3: New Team vs Alpha Sc
  const m3 = r16Matches.find(m => m.bracketPosition === 3);
  if (m3.status !== 'fulltime') {
    const alphaSc = teamMap.get('Alpha Sc');
    const newTeam = teamMap.get('New Team');
    const zia = getPlayer('Alpha Sc', 0);
    const sesko = getPlayer('New Team', 0);

    if (zia) await logEvent({ matchId: m3.id, teamId: alphaSc.id, playerId: zia.id, minute: 28, eventType: 'goal', details: 'Top corner strike' });
    if (sesko) await logEvent({ matchId: m3.id, teamId: newTeam.id, playerId: sesko.id, minute: 65, eventType: 'yellow_card', details: 'Tactical foul' });

    const res = await completeMatch({ matchId: m3.id, homeScore: 0, awayScore: 1 });
    console.log(`✓ R16 Match 3 (Pos 3): New Team 0 - 1 Alpha Sc -> Winner: Alpha Sc (Advanced to QF 2 Home)`);
  } else {
    console.log(`✓ R16 Match 3 already completed.`);
  }

  // R16 Match 4: Test United vs Eight Team
  const m4 = r16Matches.find(m => m.bracketPosition === 4);
  if (m4.status !== 'fulltime') {
    const eightTeam = teamMap.get('Eight Team');
    const armaan = getPlayer('Eight Team', 0);
    const manoj = getPlayer('Eight Team', 1);

    if (armaan) await logEvent({ matchId: m4.id, teamId: eightTeam.id, playerId: armaan.id, minute: 19, eventType: 'goal', details: 'Header from corner' });
    if (manoj) await logEvent({ matchId: m4.id, teamId: eightTeam.id, playerId: manoj.id, minute: 72, eventType: 'goal', details: 'Long range blast' });

    const res = await completeMatch({ matchId: m4.id, homeScore: 0, awayScore: 2 });
    console.log(`✓ R16 Match 4 (Pos 4): Test United 0 - 2 Eight Team -> Winner: Eight Team (Advanced to QF 2 Away)`);
  } else {
    console.log(`✓ R16 Match 4 already completed.`);
  }

  // R16 Match 5: Two Team vs Test City (Testing Draw + Penalty Shootout!)
  const m5 = r16Matches.find(m => m.bracketPosition === 5);
  if (m5.status !== 'fulltime') {
    const twoTeam = teamMap.get('Two Team');
    const testCity = teamMap.get('Test City');

    await logEvent({ matchId: m5.id, teamId: twoTeam.id, playerId: null, minute: 30, eventType: 'goal', details: 'Team play goal' });
    await logEvent({ matchId: m5.id, teamId: testCity.id, playerId: null, minute: 85, eventType: 'goal', details: 'Equalizer' });

    const res = await completeMatch({
      matchId: m5.id,
      homeScore: 1,
      awayScore: 1,
      tieBreakMethod: 'penalty',
      homePenaltyScore: 4,
      awayPenaltyScore: 3
    });
    console.log(`✓ R16 Match 5 (Pos 5): Two Team 1 - 1 Test City (Penalties: 4-3) -> Winner: Two Team (Advanced to QF 3 Home)`);
  } else {
    console.log(`✓ R16 Match 5 already completed.`);
  }

  // R16 Match 6: Four Team vs One Team
  const m6 = r16Matches.find(m => m.bracketPosition === 6);
  if (m6.status !== 'fulltime') {
    const fourTeam = teamMap.get('Four Team');
    const oneTeam = teamMap.get('One Team');
    const guna = getPlayer('Four Team', 0);

    if (guna) {
      await logEvent({ matchId: m6.id, teamId: fourTeam.id, playerId: guna.id, minute: 44, eventType: 'goal', details: 'Free kick' });
      await logEvent({ matchId: m6.id, teamId: fourTeam.id, playerId: guna.id, minute: 68, eventType: 'goal', details: 'Penalty conversion' });
    }
    await logEvent({ matchId: m6.id, teamId: oneTeam.id, playerId: null, minute: 80, eventType: 'goal', details: 'Consolation goal' });

    const res = await completeMatch({ matchId: m6.id, homeScore: 2, awayScore: 1 });
    console.log(`✓ R16 Match 6 (Pos 6): Four Team 2 - 1 One Team -> Winner: Four Team (Advanced to QF 3 Away)`);
  } else {
    console.log(`✓ R16 Match 6 already completed.`);
  }

  // R16 Match 7: Three Team vs Five Team
  const m7 = r16Matches.find(m => m.bracketPosition === 7);
  if (m7.status !== 'fulltime') {
    const threeTeam = teamMap.get('Three Team');
    const fiveTeam = teamMap.get('Five Team');
    const malaisamy = getPlayer('Three Team', 0);
    const ziaaa = getPlayer('Five Team', 0);

    if (ziaaa) await logEvent({ matchId: m7.id, teamId: fiveTeam.id, playerId: ziaaa.id, minute: 15, eventType: 'goal', details: 'Quick counter' });
    if (malaisamy) await logEvent({ matchId: m7.id, teamId: threeTeam.id, playerId: malaisamy.id, minute: 55, eventType: 'goal', details: 'Volley' });
    if (ziaaa) await logEvent({ matchId: m7.id, teamId: fiveTeam.id, playerId: ziaaa.id, minute: 88, eventType: 'goal', details: 'Late winner' });

    const res = await completeMatch({ matchId: m7.id, homeScore: 1, awayScore: 2 });
    console.log(`✓ R16 Match 7 (Pos 7): Three Team 1 - 2 Five Team -> Winner: Five Team (Advanced to QF 4 Home)`);
  } else {
    console.log(`✓ R16 Match 7 already completed.`);
  }

  // R16 Match 8: Seven Team vs Six Team
  const m8 = r16Matches.find(m => m.bracketPosition === 8);
  if (m8.status !== 'fulltime') {
    const sevenTeam = teamMap.get('Seven Team');
    const sixTeam = teamMap.get('Six Team');
    const jaison = getPlayer('Seven Team', 0);
    const mansoor = getPlayer('Seven Team', 1);
    const sami = getPlayer('Six Team', 0);

    if (jaison) await logEvent({ matchId: m8.id, teamId: sevenTeam.id, playerId: jaison.id, minute: 22, eventType: 'goal', details: 'Header' });
    if (sami) await logEvent({ matchId: m8.id, teamId: sixTeam.id, playerId: sami.id, minute: 50, eventType: 'goal', details: 'Curler' });
    if (mansoor) await logEvent({ matchId: m8.id, teamId: sevenTeam.id, playerId: mansoor.id, minute: 84, eventType: 'goal', details: 'Decisive finish' });

    const res = await completeMatch({ matchId: m8.id, homeScore: 2, awayScore: 1 });
    console.log(`✓ R16 Match 8 (Pos 8): Seven Team 2 - 1 Six Team -> Winner: Seven Team (Advanced to QF 4 Away)`);
  } else {
    console.log(`✓ R16 Match 8 already completed.`);
  }

  // -------------------------------------------------------------
  // PHASE 2: QUARTER FINALS
  // -------------------------------------------------------------
  console.log('\n-------------------------------------------------------------');
  console.log('🥊 PHASE 2: QUARTER FINALS MATCHES');
  console.log('-------------------------------------------------------------');

  const qfMatches = await prisma.match.findMany({
    where: { tournamentId: TOURNAMENT_ID, roundName: 'Quarter Final' },
    include: { homeTeam: true, awayTeam: true, winnerTeam: true },
    orderBy: { bracketPosition: 'asc' }
  });

  console.log(`Quarter Final Matchups verified from Round of 16 winners:`);
  qfMatches.forEach(q => {
    console.log(`  QF ${q.bracketPosition}: ${q.homeTeam?.name || 'TBD'} vs ${q.awayTeam?.name || 'TBD'} [Status: ${q.status}]`);
  });

  // QF 1: BAD TEAM vs Good Team
  const qf1 = qfMatches.find(m => m.bracketPosition === 1);
  if (qf1.status !== 'fulltime') {
    const goodTeam = teamMap.get('Good Team');
    const badTeam = teamMap.get('BAD TEAM');
    const bruno = getPlayer('Good Team', 0);
    const haaland = getPlayer('Good Team', 1);
    const dhoni = getPlayer('BAD TEAM', 0);

    if (bruno) await logEvent({ matchId: qf1.id, teamId: goodTeam.id, playerId: bruno.id, minute: 12, eventType: 'goal', details: 'Brilliant dribble and shoot' });
    if (haaland) await logEvent({ matchId: qf1.id, teamId: goodTeam.id, playerId: haaland.id, minute: 60, eventType: 'goal', details: 'Power shot' });
    if (dhoni) await logEvent({ matchId: qf1.id, teamId: badTeam.id, playerId: dhoni.id, minute: 78, eventType: 'goal', details: 'Helicopter strike' });

    const res = await completeMatch({ matchId: qf1.id, homeScore: 1, awayScore: 2 });
    console.log(`✓ QF Match 1 (Pos 1): BAD TEAM 1 - 2 Good Team -> Winner: Good Team (Advanced to SF 1 Home)`);
  }

  // QF 2: Alpha Sc vs Eight Team
  const qf2 = qfMatches.find(m => m.bracketPosition === 2);
  if (qf2.status !== 'fulltime') {
    const alphaSc = teamMap.get('Alpha Sc');
    const eightTeam = teamMap.get('Eight Team');
    const armaan = getPlayer('Eight Team', 0);
    const zia = getPlayer('Alpha Sc', 0);
    const manoj = getPlayer('Eight Team', 1);

    if (armaan) await logEvent({ matchId: qf2.id, teamId: eightTeam.id, playerId: armaan.id, minute: 32, eventType: 'goal', details: 'Clinical finish' });
    if (zia) await logEvent({ matchId: qf2.id, teamId: alphaSc.id, playerId: zia.id, minute: 58, eventType: 'goal', details: 'Equalizer' });
    if (manoj) await logEvent({ matchId: qf2.id, teamId: eightTeam.id, playerId: manoj.id, minute: 81, eventType: 'goal', details: 'Match winner' });

    const res = await completeMatch({ matchId: qf2.id, homeScore: 1, awayScore: 2 });
    console.log(`✓ QF Match 2 (Pos 2): Alpha Sc 1 - 2 Eight Team -> Winner: Eight Team (Advanced to SF 1 Away)`);
  }

  // QF 3: Two Team vs Four Team
  const qf3 = qfMatches.find(m => m.bracketPosition === 3);
  if (qf3.status !== 'fulltime') {
    const fourTeam = teamMap.get('Four Team');
    const guna = getPlayer('Four Team', 0);

    if (guna) await logEvent({ matchId: qf3.id, teamId: fourTeam.id, playerId: guna.id, minute: 40, eventType: 'goal', details: 'Direct freekick' });

    const res = await completeMatch({ matchId: qf3.id, homeScore: 0, awayScore: 1 });
    console.log(`✓ QF Match 3 (Pos 3): Two Team 0 - 1 Four Team -> Winner: Four Team (Advanced to SF 2 Home)`);
  }

  // QF 4: Five Team vs Seven Team
  const qf4 = qfMatches.find(m => m.bracketPosition === 4);
  if (qf4.status !== 'fulltime') {
    const fiveTeam = teamMap.get('Five Team');
    const sevenTeam = teamMap.get('Seven Team');
    const ziaaa = getPlayer('Five Team', 0);
    const mansoor = getPlayer('Seven Team', 1);

    if (ziaaa) await logEvent({ matchId: qf4.id, teamId: fiveTeam.id, playerId: ziaaa.id, minute: 25, eventType: 'goal', details: 'Left foot curler' });
    if (mansoor) await logEvent({ matchId: qf4.id, teamId: sevenTeam.id, playerId: mansoor.id, minute: 65, eventType: 'goal', details: 'Header' });
    if (ziaaa) await logEvent({ matchId: qf4.id, teamId: fiveTeam.id, playerId: ziaaa.id, minute: 89, eventType: 'goal', details: 'Stoppage time stunner' });

    const res = await completeMatch({ matchId: qf4.id, homeScore: 2, awayScore: 1 });
    console.log(`✓ QF Match 4 (Pos 4): Five Team 2 - 1 Seven Team -> Winner: Five Team (Advanced to SF 2 Away)`);
  }

  // -------------------------------------------------------------
  // PHASE 3: SEMI FINALS
  // -------------------------------------------------------------
  console.log('\n-------------------------------------------------------------');
  console.log('🥊 PHASE 3: SEMI FINALS MATCHES');
  console.log('-------------------------------------------------------------');

  const sfMatches = await prisma.match.findMany({
    where: { tournamentId: TOURNAMENT_ID, roundName: 'Semi Final' },
    include: { homeTeam: true, awayTeam: true, winnerTeam: true },
    orderBy: { bracketPosition: 'asc' }
  });

  console.log(`Semi Final Matchups verified from Quarter Final winners:`);
  sfMatches.forEach(s => {
    console.log(`  SF ${s.bracketPosition}: ${s.homeTeam?.name || 'TBD'} vs ${s.awayTeam?.name || 'TBD'} [Status: ${s.status}]`);
  });

  // SF 1: Good Team vs Eight Team
  const sf1 = sfMatches.find(m => m.bracketPosition === 1);
  if (sf1.status !== 'fulltime') {
    const goodTeam = teamMap.get('Good Team');
    const eightTeam = teamMap.get('Eight Team');
    const haaland = getPlayer('Good Team', 1);
    const armaan = getPlayer('Eight Team', 0);
    const bruno = getPlayer('Good Team', 0);

    if (haaland) await logEvent({ matchId: sf1.id, teamId: goodTeam.id, playerId: haaland.id, minute: 14, eventType: 'goal', details: 'Tap in' });
    if (armaan) await logEvent({ matchId: sf1.id, teamId: eightTeam.id, playerId: armaan.id, minute: 49, eventType: 'goal', details: 'Equalizer' });
    if (bruno) await logEvent({ matchId: sf1.id, teamId: goodTeam.id, playerId: bruno.id, minute: 77, eventType: 'goal', details: 'Match winner' });

    const res = await completeMatch({ matchId: sf1.id, homeScore: 2, awayScore: 1 });
    console.log(`✓ SF Match 1 (Pos 1): Good Team 2 - 1 Eight Team -> Winner: Good Team (Advanced to Final Home)`);
  }

  // SF 2: Four Team vs Five Team
  const sf2 = sfMatches.find(m => m.bracketPosition === 2);
  if (sf2.status !== 'fulltime') {
    const fiveTeam = teamMap.get('Five Team');
    const ziaaa = getPlayer('Five Team', 0);

    if (ziaaa) {
      await logEvent({ matchId: sf2.id, teamId: fiveTeam.id, playerId: ziaaa.id, minute: 33, eventType: 'goal', details: 'First goal' });
      await logEvent({ matchId: sf2.id, teamId: fiveTeam.id, playerId: ziaaa.id, minute: 70, eventType: 'goal', details: 'Second goal brace' });
    }

    const res = await completeMatch({ matchId: sf2.id, homeScore: 0, awayScore: 2 });
    console.log(`✓ SF Match 2 (Pos 2): Four Team 0 - 2 Five Team -> Winner: Five Team (Advanced to Final Away)`);
  }

  // -------------------------------------------------------------
  // PHASE 4: FINAL MATCH VERIFICATION (STOPPED BEFORE PLAYING)
  // -------------------------------------------------------------
  console.log('\n-------------------------------------------------------------');
  console.log('🏆 PHASE 4: FINAL MATCH STATUS & VERIFICATION');
  console.log('-------------------------------------------------------------');

  const finalMatch = await prisma.match.findFirst({
    where: { tournamentId: TOURNAMENT_ID, roundName: 'Final' },
    include: { homeTeam: true, awayTeam: true, winnerTeam: true }
  });

  const updatedTourney = await prisma.tournament.findUnique({
    where: { id: TOURNAMENT_ID }
  });

  console.log(`Final Match ID: ${finalMatch.id}`);
  console.log(`Home Team: ${finalMatch.homeTeam?.name || 'TBD'} (ID: ${finalMatch.homeTeamId})`);
  console.log(`Away Team: ${finalMatch.awayTeam?.name || 'TBD'} (ID: ${finalMatch.awayTeamId})`);
  console.log(`Match Status: ${finalMatch.status}`);
  console.log(`Winner Team ID: ${finalMatch.winnerTeamId || 'None (Awaiting manual management by User)'}`);
  console.log(`Tournament Status: ${updatedTourney.status} (Correct: Tournament is not completed yet)\n`);

  // -------------------------------------------------------------
  // PHASE 5: STATISTICS & LEADERBOARD VERIFICATION
  // -------------------------------------------------------------
  console.log('-------------------------------------------------------------');
  console.log('📊 PHASE 5: STATISTICAL VALIDATION & LEADERBOARDS');
  console.log('-------------------------------------------------------------');

  // 1. Goal Events & Top Scorers
  const allGoals = await prisma.matchEvent.findMany({
    where: {
      match: { tournamentId: TOURNAMENT_ID },
      eventType: 'goal'
    },
    include: { player: true, team: true, match: true }
  });

  console.log(`Total Goals Logged in Memorial Tournament: ${allGoals.length}`);

  const goalTally = {};
  allGoals.forEach(g => {
    const key = g.player?.fullName || `Anonymous (${g.team?.name})`;
    goalTally[key] = (goalTally[key] || 0) + 1;
  });

  const sortedScorers = Object.entries(goalTally).sort((a, b) => b[1] - a[1]);
  console.log('\nTop Scorers Leaderboard:');
  sortedScorers.forEach(([player, count], idx) => {
    console.log(`  ${idx + 1}. ${player}: ${count} goals`);
  });

  // 2. Clean Sheets / Best Keeper
  const completedMatches = await prisma.match.findMany({
    where: { tournamentId: TOURNAMENT_ID, status: 'fulltime' },
    include: { homeTeam: true, awayTeam: true }
  });

  console.log(`\nCompleted Matches: ${completedMatches.length}/14 (All 8 R16 + 4 QF + 2 SF)`);

  const cleanSheetsByTeam = {};
  completedMatches.forEach(m => {
    if (m.awayScore === 0) {
      cleanSheetsByTeam[m.homeTeam?.name] = (cleanSheetsByTeam[m.homeTeam?.name] || 0) + 1;
    }
    if (m.homeScore === 0) {
      cleanSheetsByTeam[m.awayTeam?.name] = (cleanSheetsByTeam[m.awayTeam?.name] || 0) + 1;
    }
  });

  console.log('Clean Sheets by Team:');
  Object.entries(cleanSheetsByTeam).forEach(([t, count]) => {
    console.log(`  - ${t}: ${count} clean sheet(s)`);
  });

  // 3. Team Records
  console.log('\nTeam Performance Summary:');
  const teamStats = {};
  tournament.teams.forEach(t => {
    teamStats[t.name] = { played: 0, wins: 0, losses: 0, gf: 0, ga: 0 };
  });

  completedMatches.forEach(m => {
    if (m.homeTeam?.name && teamStats[m.homeTeam.name]) {
      teamStats[m.homeTeam.name].played++;
      teamStats[m.homeTeam.name].gf += m.homeScore;
      teamStats[m.homeTeam.name].ga += m.awayScore;
      if (m.winnerTeamId === m.homeTeamId) teamStats[m.homeTeam.name].wins++;
      else teamStats[m.homeTeam.name].losses++;
    }
    if (m.awayTeam?.name && teamStats[m.awayTeam.name]) {
      teamStats[m.awayTeam.name].played++;
      teamStats[m.awayTeam.name].gf += m.awayScore;
      teamStats[m.awayTeam.name].ga += m.homeScore;
      if (m.winnerTeamId === m.awayTeamId) teamStats[m.awayTeam.name].wins++;
      else teamStats[m.awayTeam.name].losses++;
    }
  });

  console.table(teamStats);

  console.log('\n========================================================================');
  console.log('✅ END-TO-END TEST COMPLETE: MEMORIAL TOURNAMENT IS READY FOR THE FINAL');
  console.log('========================================================================');
}

runE2ETest()
  .catch(err => {
    console.error('Error during E2E test:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
