import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scriptPath = resolve(repositoryRoot, "scripts/codex/sync-agent-config.mjs");
const temporaryDirectories = [];

async function createCodeHome() {
  const directory = await mkdtemp(resolve(tmpdir(), "event-arts-codex-home-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runSync(codeHome, mode) {
  return spawnSync(process.execPath, [scriptPath, mode], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: codeHome }
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("sync-agent-config", () => {
  it("keeps the canonical Planner and bounded role definitions", async () => {
    const planner = await readFile(resolve(repositoryRoot, ".codex/agents/planner.toml"), "utf8");
    const high = await readFile(resolve(repositoryRoot, ".codex/agents/complex_implementer_high.toml"), "utf8");
    const xhigh = await readFile(resolve(repositoryRoot, ".codex/agents/complex_implementer_xhigh.toml"), "utf8");
    const rerunner = await readFile(resolve(repositoryRoot, ".codex/agents/test_rerunner.toml"), "utf8");

    expect(planner).toContain('model = "gpt-5.6-sol"');
    expect(planner).toContain('model_reasoning_effort = "medium"');
    expect(planner).toContain('sandbox_mode = "read-only"');
    expect(high).toContain('model_reasoning_effort = "high"');
    expect(xhigh).toContain('model_reasoning_effort = "xhigh"');
    expect(rerunner).toContain('model_reasoning_effort = "medium"');
  });

  it("prints usage without writing", async () => {
    const codeHome = await createCodeHome();
    const result = runSync(codeHome, "--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("reports drift, synchronizes canonical roles, then verifies the copy", async () => {
    const codeHome = await createCodeHome();
    expect(runSync(codeHome, "--check").status).toBe(1);

    const apply = runSync(codeHome, "--apply");
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain("planner.toml");
    expect(runSync(codeHome, "--check").status).toBe(0);

    const expected = await readFile(resolve(repositoryRoot, ".codex/agents/planner.toml"), "utf8");
    expect(await readFile(resolve(codeHome, "agents/planner.toml"), "utf8")).toBe(expected);
  });

  it("repairs a modified canonical target without deleting unrelated agents", async () => {
    const codeHome = await createCodeHome();
    expect(runSync(codeHome, "--apply").status).toBe(0);
    await writeFile(resolve(codeHome, "agents/planner.toml"), "drift", "utf8");
    await writeFile(resolve(codeHome, "agents/custom.toml"), "name = 'custom'", "utf8");

    expect(runSync(codeHome, "--check").status).toBe(1);
    expect(runSync(codeHome, "--apply").status).toBe(0);
    expect(await readFile(resolve(codeHome, "agents/custom.toml"), "utf8")).toBe("name = 'custom'");
  });
});
