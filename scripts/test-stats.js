import prisma from '../src/lib/prisma.js';
import { getTournamentPlayers, getTournamentStatsOverview, setBestPlayer } from '../src/controllers/statsController.js';

async function main() {
  const tournament = await prisma.tournament.findFirst({
    where: { name: 'Xyz tournament' }
  });

  if (!tournament) {
    console.log('Tournament not found');
    return;
  }

  console.log(`Testing stats & best player for: ${tournament.name} (${tournament.id})`);
  console.log(`Format: ${tournament.format}`);
  console.log(`Current bestPlayerId: ${tournament.bestPlayerId}`);

  // Test getTournamentPlayers
  let playersData = null;
  await getTournamentPlayers(
    { params: { tournamentId: tournament.id } },
    {
      status: () => ({ json: (d) => { playersData = d; } }),
      json: (d) => { playersData = d; }
    }
  );

  console.log(`Total players returned by getTournamentPlayers: ${playersData?.total || playersData?.players?.length}`);
  if (playersData?.players?.length > 0) {
    console.log('Sample player:', playersData.players[0]);
  }

  // Test getTournamentStatsOverview
  let statsOverview = null;
  await getTournamentStatsOverview(
    { params: { tournamentId: tournament.id } },
    {
      status: () => ({ json: (d) => { statsOverview = d; } }),
      json: (d) => { statsOverview = d; }
    }
  );

  console.log('Stats Overview:');
  console.log('  Top Scorer:', statsOverview?.topScorer?.player?.fullName || 'None');
  console.log('  Best Keeper:', statsOverview?.bestKeeper?.player?.fullName || 'None');
  console.log('  Best Player:', statsOverview?.bestPlayer?.fullName || 'None');

  // Test selecting the first player as Best Player
  if (playersData?.players?.length > 0) {
    const candidate = playersData.players[0];
    console.log(`\nTesting setBestPlayer with candidate: ${candidate.fullName} (${candidate.id})`);

    let setResult = null;
    await setBestPlayer(
      {
        params: { tournamentId: tournament.id },
        body: { playerId: candidate.id },
        user: { id: tournament.organizerId }
      },
      {
        status: () => ({ json: (d) => { setResult = d; } }),
        json: (d) => { setResult = d; }
      }
    );

    console.log('setBestPlayer response:', setResult?.message);
    console.log('Saved best player in response:', setResult?.tournament?.bestPlayer?.fullName, 'Team:', setResult?.tournament?.bestPlayer?.team?.name);

    // Verify stats overview again
    let updatedOverview = null;
    await getTournamentStatsOverview(
      { params: { tournamentId: tournament.id } },
      {
        status: () => ({ json: (d) => { updatedOverview = d; } }),
        json: (d) => { updatedOverview = d; }
      }
    );

    console.log('Updated Stats Overview Best Player:', updatedOverview?.bestPlayer?.fullName, 'Team:', updatedOverview?.bestPlayer?.team?.name);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
