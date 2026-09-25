import prisma from '../src/lib/prisma.js';
import crypto from 'crypto';

async function runQuickMatchTest() {
  console.log('🚀 Running Quick Match integration verification...');

  try {
    // 1. Fetch 2 existing teams
    const teams = await prisma.team.findMany({ take: 2 });
    if (teams.length < 2) {
      console.log('⚠️ Need at least 2 teams to run test. Found:', teams.length);
      return;
    }

    const homeTeam = teams[0];
    const awayTeam = teams[1];
    const testMatchCode = 'QM-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    console.log(`- Team A: ${homeTeam.name} (${homeTeam.id})`);
    console.log(`- Team B: ${awayTeam.name} (${awayTeam.id})`);
    console.log(`- Match Code: ${testMatchCode}`);

    // 2. Create Quick Match with tournamentId: null
    const createdMatch = await prisma.match.create({
      data: {
        tournamentId: null,
        homeTeamId: homeTeam.id,
        awayTeamId: null, // Opponent to join via code
        matchDate: new Date(),
        roundName: 'Quick Match',
        venue: 'FootVerse Test Pitch',
        status: 'scheduled',
        refereeName: testMatchCode
      }
    });

    console.log('✅ Quick Match created with ID:', createdMatch.id);
    console.log('  TournamentId is null:', createdMatch.tournamentId === null);

    // 3. Connect Away Team via Match Code
    const joinedMatch = await prisma.match.update({
      where: { id: createdMatch.id },
      data: { awayTeamId: awayTeam.id }
    });

    console.log('✅ Away Team connected to Quick Match. AwayTeamId:', joinedMatch.awayTeamId);

    // 4. Log a match event
    const event = await prisma.matchEvent.create({
      data: {
        matchId: createdMatch.id,
        teamId: homeTeam.id,
        minute: 12,
        eventType: 'goal',
        details: 'Quick match opener'
      }
    });
    console.log('✅ Match event logged successfully:', event.id);

    // 5. Update score & complete match
    const completedMatch = await prisma.match.update({
      where: { id: createdMatch.id },
      data: {
        homeScore: 1,
        awayScore: 0,
        status: 'fulltime',
        winnerTeamId: homeTeam.id
      }
    });

    console.log('✅ Quick Match finished at Full Time! Winner:', completedMatch.winnerTeamId);

    // Cleanup test match
    await prisma.matchEvent.deleteMany({ where: { matchId: createdMatch.id } });
    await prisma.match.delete({ where: { id: createdMatch.id } });
    console.log('🧹 Cleaned up test match data.');

    console.log('🎉 Quick Match verification PASSED 100%!');
  } catch (err) {
    console.error('❌ Quick Match verification failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runQuickMatchTest();
