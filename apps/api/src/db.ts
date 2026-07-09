import { PrismaClient } from "@prisma/client";

export type AppPrismaClient = PrismaClient;

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db") {
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl }
    }
  });
}
