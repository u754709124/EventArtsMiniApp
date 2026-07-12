import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const initScript = resolve(repositoryRoot, "scripts/codex/init-plan-run.mjs");
const persistScript = resolve(repositoryRoot, "scripts/codex/persist-planner-output.mjs");
const stateScript = resolve(repositoryRoot, "scripts/codex/update-plan-state.mjs");
const cleanupScript = resolve(repositoryRoot, "scripts/codex/cleanup-plan-run.mjs");
const validFixture = resolve(repositoryRoot, "scripts/codex/fixtures/planner-output-valid.md");
const temporaryDirectories = [];

async function createPlansRoot() {
  const directory = await mkdtemp(resolve(tmpdir(), "event-arts-state-"));
  temporaryDirectories.push(directory);
  return directory;
}

function run(script, argumentsList) {
  return spawnSync(process.execPath, [script, ...argumentsList], { cwd: repositoryRoot, encoding: "utf8" });
}

function stateArguments(action, taskId, plansRoot, extra = []) {
  return ["--action", action, "--task-id", taskId, "--plans-root", plansRoot, ...extra];
}

function initializeAndPersist(plansRoot, taskId) {
  expect(run(initScript, ["--task-id", taskId, "--classification", "COMPLEX", "--plans-root", plansRoot]).status).toBe(0);
  expect(run(persistScript, ["--task-id", taskId, "--planner-output", validFixture, "--plans-root", plansRoot]).status).toBe(0);
  return resolve(plansRoot, taskId);
}

async function passAndRecordGoal(taskId, plansRoot, planDirectory, goalId) {
  expect(run(stateScript, stateArguments("goal", taskId, plansRoot, ["--goal", goalId, "--status", "in_progress"])).status).toBe(0);
  expect(run(stateScript, stateArguments("goal", taskId, plansRoot, ["--goal", goalId, "--status", "passed"])).status).toBe(0);
  const result = `results/${goalId}-result.md`;
  await writeFile(resolve(planDirectory, result), `# ${goalId}\n`, "utf8");
  expect(run(stateScript, stateArguments("result", taskId, plansRoot, ["--goal", goalId, "--result", result, "--test-result", "passed"])).status).toBe(0);
}

async function completeRun(taskId, plansRoot, planDirectory) {
  await passAndRecordGoal(taskId, plansRoot, planDirectory, "G01");
  await passAndRecordGoal(taskId, plansRoot, planDirectory, "G02");
  expect(run(stateScript, stateArguments("verification", taskId, plansRoot, ["--name", "final", "--status", "passed", "--command", "pnpm test"])).status).toBe(0);
  expect(run(stateScript, stateArguments("complete", taskId, plansRoot, ["--documentation", "docs/codex/agent-roles.md"])).status).toBe(0);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("plan state, recovery, and cleanup", () => {
  it("enforces transitions, prerequisites, one running agent, and recorded results", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-state-test";
    const planDirectory = initializeAndPersist(plansRoot, taskId);

    const blockedByPrerequisite = run(stateScript, stateArguments("goal", taskId, plansRoot, ["--goal", "G02", "--status", "in_progress"]));
    expect(blockedByPrerequisite.status).toBe(1);
    expect(blockedByPrerequisite.stderr).toContain("requires G01");

    expect(run(stateScript, stateArguments("goal", taskId, plansRoot, ["--goal", "G01", "--status", "in_progress"])).status).toBe(0);
    expect(run(stateScript, stateArguments("agent-start", taskId, plansRoot, ["--agent-id", "writer-001", "--role", "complex_implementer_high", "--goal", "G01"])).status).toBe(0);
    const secondAgent = run(stateScript, stateArguments("agent-start", taskId, plansRoot, ["--agent-id", "writer-002", "--role", "complex_implementer_high", "--goal", "G01"]));
    expect(secondAgent.status).toBe(1);
    expect(secondAgent.stderr).toContain("Only one");
    expect(run(stateScript, stateArguments("agent-finish", taskId, plansRoot, ["--agent-id", "writer-001", "--outcome", "passed"])).status).toBe(0);
    expect(run(stateScript, stateArguments("goal", taskId, plansRoot, ["--goal", "G01", "--status", "passed"])).status).toBe(0);
    await writeFile(resolve(planDirectory, "results/G01-result.md"), "# G01\n", "utf8");
    expect(run(stateScript, stateArguments("result", taskId, plansRoot, ["--goal", "G01", "--result", "results/G01-result.md", "--test-result", "passed"])).status).toBe(0);
    const manifest = JSON.parse(await readFile(resolve(planDirectory, "manifest.json"), "utf8"));
    expect(manifest.goals.find((goal) => goal.id === "G01").implementation_result).toBe("results/G01-result.md");
  });

  it("stops recovery on multiple candidates and creates only the next Planner-approved revision", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-revision-test";
    initializeAndPersist(plansRoot, taskId);
    expect(run(initScript, ["--task-id", "20260712T000000Z-other-test", "--classification", "COMPLEX", "--plans-root", plansRoot]).status).toBe(0);

    const multiple = run(stateScript, ["--action", "recover", "--plans-root", plansRoot]);
    expect(multiple.status).toBe(1);
    expect(multiple.stderr).toContain("Multiple recoverable tasks");
    expect(run(stateScript, stateArguments("recover", taskId, plansRoot)).status).toBe(0);

    expect(run(stateScript, stateArguments("create-revision", taskId, plansRoot, ["--revision", "1"])).status).toBe(1);
    expect(run(stateScript, stateArguments("create-revision", taskId, plansRoot, ["--revision", "1", "--planner-approved"])).status).toBe(0);
    await access(resolve(plansRoot, taskId, "revisions/r1/tasks"), constants.F_OK);
    expect(run(stateScript, stateArguments("create-revision", taskId, plansRoot, ["--revision", "1", "--planner-approved"])).status).toBe(1);
  });

  it("rejects cleanup until completion evidence is complete, then supports dry-run and task-only removal", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-cleanup-test";
    const planDirectory = initializeAndPersist(plansRoot, taskId);
    expect(run(cleanupScript, ["--task-id", taskId, "--plans-root", plansRoot, "--execute"]).status).toBe(1);

    await completeRun(taskId, plansRoot, planDirectory);
    const dryRun = run(cleanupScript, ["--task-id", taskId, "--plans-root", plansRoot, "--dry-run"]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain('"dry_run":true');
    expect(run(cleanupScript, ["--task-id", taskId, "--plans-root", plansRoot, "--execute"]).status).toBe(0);
    await expect(access(planDirectory, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
    await access(plansRoot, constants.F_OK);
  });

  it("rejects failed tasks from cleanup", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-failed-cleanup";
    const planDirectory = initializeAndPersist(plansRoot, taskId);
    expect(run(stateScript, stateArguments("goal", taskId, plansRoot, ["--goal", "G01", "--status", "failed"])).status).toBe(0);
    expect(JSON.parse(await readFile(resolve(planDirectory, "manifest.json"), "utf8")).status).toBe("failed");
    expect(run(cleanupScript, ["--task-id", taskId, "--plans-root", plansRoot, "--execute"]).status).toBe(1);
  });

  it("refuses cleanup with a running agent or incomplete verification even if completion state is forged", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-cleanup-negative";
    const planDirectory = initializeAndPersist(plansRoot, taskId);
    const manifestPath = resolve(planDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const goal of manifest.goals) {
      goal.status = "passed";
      goal.implementation_result = `results/${goal.id}-result.md`;
      goal.test_result = "passed";
    }
    manifest.status = "completed";
    manifest.completion = { documentation: "docs/codex/agent-roles.md" };
    manifest.running_agents = [{ id: "writer-001", role: "test", goal_id: "G01" }];
    manifest.verification = { final: { status: "passed" } };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    const runningAgent = run(cleanupScript, ["--task-id", taskId, "--plans-root", plansRoot, "--execute"]);
    expect(runningAgent.status).toBe(1);
    expect(runningAgent.stderr).toContain("running agents");

    manifest.running_agents = [];
    manifest.verification = {};
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    const unverified = run(cleanupScript, ["--task-id", taskId, "--plans-root", plansRoot, "--execute"]);
    expect(unverified.status).toBe(1);
    expect(unverified.stderr).toContain("verification");
  });
});
