import path from "node:path";
import { createPrismaClient } from "../src/db";
import { seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const prisma = createPrismaClient();

await ensureDatabaseSchema(prisma);
await seedDatabase(prisma, {
  uploadDir: path.resolve(process.cwd(), "../../uploads"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3001",
  reset: true
});

await prisma.$disconnect();
console.log("Seed complete: admin/admin123456");
