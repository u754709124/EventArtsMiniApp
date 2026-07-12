import { loadApiConfig } from "../src/config";
import { createPrismaClient } from "../src/db";
import { assertCanSeedDatabase, seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const config = loadApiConfig();

assertCanSeedDatabase(config.env);

const prisma = createPrismaClient(config.databaseUrl);

await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
await seedDatabase(prisma, {
  uploadDir: config.paths.uploadDir,
  publicBaseUrl: config.publicBaseUrl,
  env: config.env,
  reset: true
});

await prisma.$disconnect();
console.log("Seed complete: demo content only");
