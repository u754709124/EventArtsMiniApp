import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApiConfig, type LoadApiConfigOptions } from "./config";
import { createPrismaClient } from "./db";
import type { EdgeOneClientFactory } from "./edgeone";
import { ensureDatabaseSchema } from "./sqlite-schema";

type ReconcileCommandOptions = {
  config?: LoadApiConfigOptions;
  clientFactory?: EdgeOneClientFactory;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
  now?: () => Date;
  leaseMs?: number;
};

export async function runEdgeOnePrefetchReconcile(options: ReconcileCommandOptions = {}) {
  const config = loadApiConfig(options.config);
  const writeOutput = options.writeOutput ?? console.log;
  const writeError = options.writeError ?? console.error;
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
    const [{ createScheduledTaskRunner }, { createScheduledTaskHandlers }] = await Promise.all([
      import("./scheduled-tasks"),
      import("./scheduled-task-handlers")
    ]);
    const runner = createScheduledTaskRunner({
      prisma,
      now: options.now,
      leaseMs: options.leaseMs,
      handlers: createScheduledTaskHandlers({
        prisma,
        publicBaseUrl: config.publicBaseUrl,
        analytics: config.analytics,
        edgeOne: {
          credentialEncryptionKey: config.edgeOne.credentialEncryptionKey,
          prefetch: config.edgeOne.prefetch,
          clientFactory: options.clientFactory
        },
        writeOutput,
        writeError
      })
    });
    const result = await runner.run("edgeone-prefetch-reconcile");
    if (result.resultSummary.status === "disabled") return { status: "disabled" as const };
    return { status: "completed" as const, result: result.resultSummary };
  } finally {
    await prisma.$disconnect();
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isEntryPoint()) {
  runEdgeOnePrefetchReconcile().catch(() => {
    process.exitCode = 1;
  });
}
