import { describe, expect, it, vi } from "vitest";
import { startApiServer } from "../src/server";

describe("EdgeOne prefetch server integration", () => {
  it("passes the validated feature gate into buildApp", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn().mockResolvedValue(undefined);
    const build = vi.fn().mockResolvedValue({
      listen,
      log: { info: vi.fn() }
    });
    const createPrisma = vi.fn().mockReturnValue({ $disconnect: disconnect });

    const result = await startApiServer({
      config: {
        repositoryRoot: process.cwd(),
        processEnv: {
          NODE_ENV: "development",
          JWT_SECRET: "prefetch-server-test-secret",
          DATABASE_URL: "file:./prefetch-server-test.db",
          PUBLIC_BASE_URL: "https://media.example.com",
          EDGEONE_PREFETCH_ENABLED: "true"
        }
      },
      createPrisma: createPrisma as never,
      build: build as never
    });

    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      edgeOne: expect.objectContaining({
        prefetch: expect.objectContaining({ enabled: true, maxBatchSize: 20 })
      })
    }));
    expect(listen).toHaveBeenCalledOnce();
    await result.prisma.$disconnect();
  });
});
