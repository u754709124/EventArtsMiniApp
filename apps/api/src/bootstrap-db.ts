import { loadApiConfig } from "./config";
import { createPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

const config = loadApiConfig();
const prisma = createPrismaClient(config.databaseUrl);
await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
await prisma.$disconnect();
console.log("SQLite schema ready");
