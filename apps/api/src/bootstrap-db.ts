import { createPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

const prisma = createPrismaClient();
await ensureDatabaseSchema(prisma);
await prisma.$disconnect();
console.log("SQLite schema ready");
