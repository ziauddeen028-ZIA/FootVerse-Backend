/**
 * Backfill Script: Generate teamCode for existing teams that lack one.
 * Run once: node backfill-team-codes.js
 */
import { PrismaClient } from './generated/prisma/index.js';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function generateUniqueCode(existingCodes) {
  let code;
  do {
    code = randomBytes(4).toString('hex').toUpperCase();
  } while (existingCodes.has(code));
  existingCodes.add(code);
  return code;
}

async function main() {
  console.log('🔑 Starting teamCode backfill...');

  // Get all teams missing a teamCode
  const teamsWithoutCode = await prisma.team.findMany({
    where: { teamCode: null },
    select: { id: true, name: true }
  });

  if (teamsWithoutCode.length === 0) {
    console.log('✅ All teams already have a teamCode. Nothing to do.');
    return;
  }

  console.log(`📋 Found ${teamsWithoutCode.length} team(s) without a code. Generating...`);

  // Collect existing codes to avoid collisions
  const existingCodes = new Set(
    (await prisma.team.findMany({ where: { teamCode: { not: null } }, select: { teamCode: true } }))
      .map(t => t.teamCode)
  );

  let updated = 0;
  for (const team of teamsWithoutCode) {
    const code = await generateUniqueCode(existingCodes);
    await prisma.team.update({
      where: { id: team.id },
      data: { teamCode: code }
    });
    console.log(`  ✔ ${team.name} → ${code}`);
    updated++;
  }

  console.log(`\n🎉 Done! Updated ${updated} team(s).`);
}

main()
  .catch(e => {
    console.error('❌ Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
