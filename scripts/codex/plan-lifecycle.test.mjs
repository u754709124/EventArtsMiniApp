import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scripts = Object.freeze({
  classify: resolve(repositoryRoot, "scripts/codex/classify-task.mjs"),
  init: resolve(repositoryRoot, "scripts/codex/init-plan-run.mjs"),
  persist: resolve(repositoryRoot, "scripts/codex/persist-planner-output.mjs"),
  verify: resolve(repositoryRoot, "scripts/codex/verify-plan-integrity.mjs"),
  state: resolve(repositoryRoot, "scripts/codex/update-plan-state.mjs"),
  cleanup: resolve(repositoryRoot, "scripts/codex/cleanup-plan-run.mjs")
});
const validFixture = resolve(repositoryRoot, "scripts/codex/fixtures/planner-output-valid.md");
const temporaryDirectories = [];

async function createPlansRoot() {
  const directory = await mkdtemp(resolve(tmpdir(), "event-arts-lifecycle-"));
  temporaryDirectories.push(directory);
  return directory;
}

function run(script, argumentsList) {
  return spawnSync(process.execPath, [script, ...argumentsList], { cwd: repositoryRoot, encoding: "utf8" });
}

function expectSuccess(script, argumentsList) {
  const result = run(script, argumentsList);
  expect(result.status, result.stderr).toBe(0);
  return result;
}

function state(taskId, plansRoot, action, extra = []) {
  return expectSuccess(scripts.state, ["--action", action, "--task-id", taskId, "--plans-root", plansRoot, ...extra]);
}

async function passGoal(taskId, plansRoot, planDirectory, goalId) {
  state(taskId, plansRoot, "goal", ["--goal", goalId, "--status", "in_progress"]);
  state(taskId, plansRoot, "goal", ["--goal", goalId, "--status", "passed"]);
  const resultPath = `results/${goalId}-result.md`;
  await writeFile(resolve(planDirectory, resultPath), `# ${goalId} fixture result\n`, "utf8");
  state(taskId, plansRoot, "result", ["--goal", goalId, "--result", resultPath, "--test-result", "fixture passed"]);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Codex plan lifecycle fixture", () => {
  it("runs classify → init → persist → verify → state → revision → completion → dry-run → task-only cleanup", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-lifecycle-fixture";
    const siblingId = "20260712T000000Z-lifecycle-sibling";
    const classification = expectSuccess(scripts.classify, ["--request", "Change API and miniapp architecture", "--affected-path", "apps/api", "--affected-path", "apps/miniapp"]);
    expect(JSON.parse(classification.stdout).classification).toBe("COMPLEX");

    expectSuccess(scripts.init, ["--task-id", taskId, "--classification", "COMPLEX", "--plans-root", plansRoot]);
    expectSuccess(scripts.persist, ["--task-id", taskId, "--planner-output", validFixture, "--plans-root", plansRoot]);
    expectSuccess(scripts.verify, ["--task-id", taskId, "--plans-root", plansRoot]);
    const planDirectory = resolve(plansRoot, taskId);

    state(taskId, plansRoot, "create-revision", ["--revision", "1", "--planner-approved"]);
    expectSuccess(scripts.persist, ["--task-id", taskId, "--planner-output", validFixture, "--revision", "1", "--plans-root", plansRoot]);
    expectSuccess(scripts.verify, ["--task-id", taskId, "--revision", "1", "--plans-root", plansRoot]);
    await access(resolve(planDirectory, "planner-output.md"), constants.F_OK);
    await access(resolve(planDirectory, "revisions/r1/planner-output.md"), constants.F_OK);

    await passGoal(taskId, plansRoot, planDirectory, "G01");
    await passGoal(taskId, plansRoot, planDirectory, "G02");
    state(taskId, plansRoot, "verification", ["--name", "final", "--status", "passed", "--command", "pnpm test:codex"]);
    state(taskId, plansRoot, "complete", ["--documentation", "docs/codex/planning-and-goals.md"]);
    expect(JSON.parse(await readFile(resolve(planDirectory, "manifest.json"), "utf8")).status).toBe("completed");

    expectSuccess(scripts.init, ["--task-id", siblingId, "--classification", "COMPLEX", "--plans-root", plansRoot]);
    const dryRun = expectSuccess(scripts.cleanup, ["--task-id", taskId, "--plans-root", plansRoot, "--dry-run"]);
    expect(JSON.parse(dryRun.stdout).dry_run).toBe(true);
    expectSuccess(scripts.cleanup, ["--task-id", taskId, "--plans-root", plansRoot, "--execute"]);
    await expect(access(planDirectory, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
    await access(resolve(plansRoot, siblingId, "manifest.json"), constants.F_OK);
  });

  it("provides help for all six lifecycle CLIs without external dependencies", () => {
    for (const script of Object.values(scripts)) {
      const result = run(script, ["--help"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Usage:");
    }
  });
});
