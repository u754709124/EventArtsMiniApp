import path from "node:path";
import { buildApp } from "./app";
import { createPrismaClient } from "./db";

const prisma = createPrismaClient();
const app = await buildApp({
  prisma,
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "../../uploads"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3001"
});

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
await app.listen({ port, host });
console.log(`API listening on http://${host}:${port}`);
