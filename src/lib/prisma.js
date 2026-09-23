import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/index.js";

// Create PostgreSQL adapter
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

// Prevent multiple instances of Prisma Client in development
const prisma =
  global.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV === "development") {
  global.prisma = prisma;
}

export default prisma;