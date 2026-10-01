import prisma from '../src/lib/prisma.js';
import { calculateGroupStandings } from '../src/controllers/standingsController.js';
import { parseTournamentConfig } from '../src/controllers/tournamentController.js';

const REALISTIC_SCORES = [
  [1, 0], [2, 1], [2, 0], [1, 1], [3, 1],
  [0, 1], [1, 2], [0, 2], [2, 2], [3, 2],
  [1, 0], [2, 1], [0, 0], [1, 2], [2, 0]
];

async function main() {
  console.log('⚽ Starting Group Stage match completion script...');

  // 1. Find group_stage / hybrid tournaments
  const tournaments = await prisma.tournament.findMany({
    where: {
      format: { in: ['group_stage', 'hybrid'] }
    },
    orderBy: { createdAt: 'desc' },
    include: {
      teams: true,
      matches: {
        where: { bracketPosition: null },
        include: {
          homeTeam: true,
          awayTeam: true
        },
        orderBy: { matchDate: 'asc' }
      }
    }
  });

  if (!tournaments || tournaments.length === 0) {
    console.log('❌ No group stage tournaments found.');
    process.exit(1);
  }

  // Find tournament that has matches
  const targetTournament = tournaments.find(t => t.matches.length > 0) || tournaments[0];
  console.log(`\n🏆 Target Tournament: "${targetTournament.name}" (ID: ${targetTournament.id}, Format: ${targetTournament.format})`);
  console.log(`📋 Total Group Matches in Tournament: ${targetTournament.matches.length}`);

  const existingCompleted = targetTournament.matches.filter(
    m => m.status === 'fulltime' || m.status === 'completed'
  );
  const unfinished = targetTournament.matches.filter(
    m => m.status !== 'fulltime' && m.status !== 'completed'
  );

  console.log(`✅ Already Completed Matches (kept untouched): ${existingCompleted.length}`);
  for (const m of existingCompleted) {
    console.log(`   - [${m.roundName}] ${m.homeTeam?.name || 'TBD'} ${m.homeScore} - ${m.awayScore} ${m.awayTeam?.name || 'TBD'} (${m.status})`);
  }

  console.log(`⏳ Unfinished Matches to Complete: ${unfinished.length}`);

  let scoreIdx = 0;
  for (const match of unfinished) {
    const [hScore, aScore] = REALISTIC_SCORES[scoreIdx % REALISTIC_SCORES.length];
    scoreIdx++;

    let winnerTeamId = null;
    if (hScore > aScore) winnerTeamId = match.homeTeamId;
    else if (aScore > hScore) winnerTeamId = match.awayTeamId;

    await prisma.match.update({
      where: { id: match.id },
      data: {
        homeScore: hScore,
        awayScore: aScore,
        winnerTeamId,
        status: 'fulltime'
      }
    });

    console.log(`   ✓ Simulated: [${match.roundName}] ${match.homeTeam?.name} ${hScore} - ${aScore} ${match.awayTeam?.name}`);
  }

  // Fetch updated teams and fulltime matches
  const teams = await prisma.team.findMany({
    where: { tournamentId: targetTournament.id }
  });

  const allCompletedMatches = await prisma.match.findMany({
    where: {
      tournamentId: targetTournament.id,
      bracketPosition: null,
      status: 'fulltime'
    }
  });

  const config = parseTournamentConfig(targetTournament.description);
  const groups = calculateGroupStandings(teams, allCompletedMatches, config);

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 FINAL GROUP STAGE STANDINGS (${allCompletedMatches.length} Matches Completed)`);
  console.log('════════════════════════════════════════════════════════════════════════════════');

  const qualifiers = [];

  for (const group of groups) {
    console.log(`\n📁 ${group.name.toUpperCase()}`);
    console.log('Pos | Team Name                 | P | W | D | L | GF | GA | GD  | Pts | Status');
    console.log('----+---------------------------+---+---+---+---+----+----+-----+-----+--------------');

    group.standings.forEach((row, i) => {
      const pos = row.position || i + 1;
      const isQualified = pos <= 2;
      const statusLabel = pos === 1 ? '🥇 Winner (Q)' : pos === 2 ? '🥈 Runner-Up (Q)' : '   Eliminated';
      if (isQualified) qualifiers.push({ group: group.name, pos, team: row.team, points: row.points });

      const name = (row.team?.name || 'Unknown').padEnd(25, ' ');
      const p = String(row.played).padStart(1, ' ');
      const w = String(row.won).padStart(1, ' ');
      const d = String(row.drawn).padStart(1, ' ');
      const l = String(row.lost).padStart(1, ' ');
      const gf = String(row.goalsFor).padStart(2, ' ');
      const ga = String(row.goalsAgainst).padStart(2, ' ');
      const gd = (row.goalDifference > 0 ? `+${row.goalDifference}` : String(row.goalDifference)).padStart(3, ' ');
      const pts = String(row.points).padStart(3, ' ');

      console.log(` ${pos}  | ${name} | ${p} | ${w} | ${d} | ${l} | ${gf} | ${ga} | ${gd} | ${pts} | ${statusLabel}`);
    });
  }

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`🎉 TOP 2 QUALIFIERS FROM EACH GROUP (${qualifiers.length} TEAMS QUALIFIED FOR KNOCKOUT)`);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  qualifiers.forEach(q => {
    console.log(` • [${q.group}] Rank ${q.pos}: ${q.team.name} (${q.points} pts)`);
  });

  console.log('\n✅ All Group Stage matches are now fulltime and ready for Knockout Bracket generation!\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
