import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertTaskId, createInitialManifest, sha256, validateManifest } from "./lib/plan-run.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const classifyScript = resolve(repositoryRoot, "scripts/codex/classify-task.mjs");
const initScript = resolve(repositoryRoot, "scripts/codex/init-plan-run.mjs");
const temporaryDirectories = [];

async function createPlansRoot() {
  const directory = await mkdtemp(resolve(tmpdir(), "event-arts-plans-"));
  temporaryDirectories.push(directory);
  return directory;
}

function run(script, argumentsList) {
  return spawnSync(process.execPath, [script, ...argumentsList], { cwd: repositoryRoot, encoding: "utf8" });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("plan-run primitives", () => {
  it("accepts safe IDs and rejects path traversal and repeated separators", () => {
    expect(assertTaskId("20260712T000000Z-codex-orchestration")).toBe("20260712T000000Z-codex-orchestration");
    for (const invalidId of ["../escape", "a--b", "ab", "task/child"]) {
      expect(() => assertTaskId(invalidId)).toThrow();
    }
  });

  it("uses stable SHA-256 and validates initial manifest state", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const manifest = createInitialManifest({ taskId: "20260712-codex-orchestration", title: "Test", classification: "COMPLEX" });
    expect(validateManifest(manifest).status).toBe("planned");
    expect(() => createInitialManifest({ taskId: "20260712-codex-orchestration", classification: "SIMPLE" })).toThrow();
  });

  it("accepts recoverable task states used by revision and cleanup workflows", () => {
    const manifest = createInitialManifest({ taskId: "20260712-codex-orchestration", classification: "COMPLEX" });
    for (const status of ["blocked", "awaiting_user", "verification_failed", "completed_and_archived"]) {
      expect(validateManifest({ ...manifest, status }).status).toBe(status);
    }
  });

  it("classifies clear maintenance as SIMPLE and ambiguous/cross-area work as COMPLEX JSON", () => {
    const simple = run(classifyScript, ["--request", "Fix a README heading typo", "--affected-path", "README.md"]);
    expect(simple.status).toBe(0);
    expect(JSON.parse(simple.stdout).classification).toBe("SIMPLE");

    const complex = run(classifyScript, ["--request", "Add a feature", "--affected-path", "apps/api/src/app.ts", "--affected-path", "apps/miniapp/src/app.ts"]);
    expect(complex.status).toBe(0);
    expect(JSON.parse(complex.stdout).classification).toBe("COMPLEX");
  });

  it("initializes only a new COMPLEX plan with the standard structure", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712-g02-test";
    const initialized = run(initScript, ["--task-id", taskId, "--classification", "COMPLEX", "--title", "Test plan", "--plans-root", plansRoot]);
    expect(initialized.status).toBe(0);
    const planDirectory = resolve(plansRoot, taskId);
    expect(await readdir(planDirectory)).toEqual(expect.arrayContaining(["handoffs", "manifest.json", "progress.md", "results", "revisions", "tasks"]));
    const originalManifest = await readFile(resolve(planDirectory, "manifest.json"), "utf8");
    expect(JSON.parse(originalManifest)).toMatchObject({ task_id: taskId, status: "planned" });
    expect(run(initScript, ["--task-id", taskId, "--classification", "COMPLEX", "--plans-root", plansRoot]).status).toBe(1);
    expect(await readFile(resolve(planDirectory, "manifest.json"), "utf8")).toBe(originalManifest);
  });

  it("rejects an unsafe task ID before creating the plans root", async () => {
    const parent = await createPlansRoot();
    const missingPlansRoot = resolve(parent, "not-created");
    const result = run(initScript, ["--task-id", "../escape", "--classification", "COMPLEX", "--plans-root", missingPlansRoot]);
    expect(result.status).toBe(1);
    await expect(readdir(missingPlansRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create a plans root or task directory for SIMPLE initialization", async () => {
    const parent = await createPlansRoot();
    const missingPlansRoot = resolve(parent, "not-created");
    const result = run(initScript, ["--task-id", "20260712-simple-test", "--classification", "SIMPLE", "--plans-root", missingPlansRoot]);
    expect(result.status).toBe(0);
    await expect(readdir(missingPlansRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
