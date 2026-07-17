import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApiConfig, type LoadApiConfigOptions } from "./config";
import { createPrismaClient } from "./db";
import {
  asEdgeOneDomainError,
  createEdgeOnePrefetchService,
  type EdgeOneClientFactory
} from "./edgeone";

type ReconcileCommandOptions = {
  config?: LoadApiConfigOptions;
  clientFactory?: EdgeOneClientFactory;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
};

export async function runEdgeOnePrefetchReconcile(options: ReconcileCommandOptions = {}) {
  const config = loadApiConfig(options.config);
  const writeOutput = options.writeOutput ?? console.log;
  const writeError = options.writeError ?? console.error;
  if (!config.edgeOne.prefetch.enabled) {
    writeOutput(JSON.stringify({
      event: "edgeone_prefetch_reconcile",
      status: "disabled"
    }));
    return { status: "disabled" as const };
  }

  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const service = createEdgeOnePrefetchService({
      prisma,
      publicBaseUrl: config.publicBaseUrl,
      credentialEncryptionKey: config.edgeOne.credentialEncryptionKey,
      config: config.edgeOne.prefetch,
      clientFactory: options.clientFactory
    });
    const result = await service.reconcile();
    writeOutput(JSON.stringify({
      event: "edgeone_prefetch_reconcile",
      status: "completed",
      ...result
    }));
    return { status: "completed" as const, result };
  } catch (error) {
    const safe = asEdgeOneDomainError(error);
    writeError(JSON.stringify({
      event: "edgeone_prefetch_reconcile",
      status: "failed",
      businessCode: safe.code,
      ...(safe.upstreamCode ? { upstreamCode: safe.upstreamCode } : {}),
      ...(safe.upstreamRequestId ? { upstreamRequestId: safe.upstreamRequestId } : {})
    }));
    throw safe;
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
