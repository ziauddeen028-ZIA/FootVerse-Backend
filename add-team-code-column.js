import { PrismaClient } from './generated/prisma/index.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Adding team_code column to teams table...');
  
  await prisma.$executeRawUnsafe(`
    ALTER TABLE public.teams 
    ADD COLUMN IF NOT EXISTS team_code VARCHAR(8);
  `);
  console.log('Column added.');

  // Add unique index if not exists
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'teams' AND indexname = 'teams_team_code_key'
      ) THEN
        CREATE UNIQUE INDEX teams_team_code_key ON public.teams(team_code) WHERE team_code IS NOT NULL;
      END IF;
    END$$;
  `);
  console.log('Unique index ensured.');
  console.log('Done!');
}

main()
  .catch(e => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
