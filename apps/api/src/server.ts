import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildApp } from "./app";
import { ConfigValidationError, loadApiConfig, type LoadApiConfigOptions } from "./config";
import { createPrismaClient } from "./db";
import { redactSensitive } from "./logging";

type StartApiServerOptions = {
  config?: LoadApiConfigOptions;
  createPrisma?: typeof createPrismaClient;
  build?: typeof buildApp;
};

export async function startApiServer(options: StartApiServerOptions = {}) {
  const config = loadApiConfig(options.config);
  const prisma = (options.createPrisma ?? createPrismaClient)(config.databaseUrl);
  try {
    const app = await (options.build ?? buildApp)({
      prisma,
      jwtSecret: config.jwt.secret,
      uploadDir: config.paths.uploadDir,
      backupDir: config.paths.backupDir,
      databaseUrl: config.databaseUrl,
      publicBaseUrl: config.publicBaseUrl,
      cors: config.cors,
      rateLimit: config.rateLimit,
      analytics: config.analytics,
      clientAuth: config.clientAuth,
      edgeOne: {
        credentialEncryptionKey: config.edgeOne.credentialEncryptionKey
      }
    });
    await app.listen({ port: config.server.port, host: config.server.host });
    app.log.info({
      event: "api_listening",
      config: redactSensitive({
        env: config.env,
        server: config.server,
        publicBaseUrl: config.publicBaseUrl,
        databaseUrl: config.databaseUrl,
        paths: config.paths,
        jwt: config.jwt,
        clientAuth: config.clientAuth,
        cors: config.cors,
        rateLimit: config.rateLimit,
        analytics: config.analytics,
        edgeOne: {
          credentialEncryptionKeyConfigured: Boolean(config.edgeOne.credentialEncryptionKey)
        }
      })
    }, "API listening");
    return { app, prisma, config };
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isEntryPoint()) {
  startApiServer().catch((error) => {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
