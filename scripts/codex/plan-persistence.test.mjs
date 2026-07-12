import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const initScript = resolve(repositoryRoot, "scripts/codex/init-plan-run.mjs");
const persistScript = resolve(repositoryRoot, "scripts/codex/persist-planner-output.mjs");
const verifyScript = resolve(repositoryRoot, "scripts/codex/verify-plan-integrity.mjs");
const validFixture = resolve(repositoryRoot, "scripts/codex/fixtures/planner-output-valid.md");
const temporaryDirectories = [];

async function createPlansRoot() {
  const directory = await mkdtemp(resolve(tmpdir(), "event-arts-persistence-"));
  temporaryDirectories.push(directory);
  return directory;
}

function run(script, argumentsList) {
  return spawnSync(process.execPath, [script, ...argumentsList], { cwd: repositoryRoot, encoding: "utf8" });
}

function initializeAndPersist(plansRoot, taskId = "20260712T000000Z-persistence-test") {
  expect(run(initScript, ["--task-id", taskId, "--classification", "COMPLEX", "--plans-root", plansRoot]).status).toBe(0);
  expect(run(persistScript, ["--task-id", taskId, "--planner-output", validFixture, "--plans-root", plansRoot]).status).toBe(0);
  return resolve(plansRoot, taskId);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Planner persistence and integrity", () => {
  it("persists the exact Goal and Gxx sections, hashes them, and verifies them", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-persistence-test";
    const planDirectory = initializeAndPersist(plansRoot, taskId);
    const rawPlannerOutput = await readFile(validFixture, "utf8");
    const expectedGoal = rawPlannerOutput.slice(rawPlannerOutput.indexOf("# EXECUTION GOAL"), rawPlannerOutput.indexOf("# Execution Plan"));

    expect(await readFile(resolve(planDirectory, "goal.md"), "utf8")).toBe(expectedGoal);
    expect(await readFile(resolve(planDirectory, "tasks/G02.md"), "utf8")).toContain("G01 passed.");
    expect(run(verifyScript, ["--task-id", taskId, "--plans-root", plansRoot]).status).toBe(0);
  });

  it("rejects duplicate Goal headings without writing immutable plan files", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-duplicate-goal";
    expect(run(initScript, ["--task-id", taskId, "--classification", "COMPLEX", "--plans-root", plansRoot]).status).toBe(0);
    const invalidOutput = resolve(plansRoot, "duplicate-goal.md");
    await writeFile(invalidOutput, `${await readFile(validFixture, "utf8")}\n# EXECUTION GOAL\n\nDuplicate.\n`, "utf8");

    const result = run(persistScript, ["--task-id", taskId, "--planner-output", invalidOutput, "--plans-root", plansRoot]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exactly one");
    await expect(readFile(resolve(plansRoot, taskId, "planner-output.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails integrity checks for tampering, missing files, symlinks, and escaped manifest references", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-integrity-test";
    const planDirectory = initializeAndPersist(plansRoot, taskId);
    const verifyArguments = ["--task-id", taskId, "--plans-root", plansRoot];

    await writeFile(resolve(planDirectory, "goal.md"), "tampered", "utf8");
    expect(run(verifyScript, verifyArguments).status).toBe(1);

    await writeFile(resolve(planDirectory, "goal.md"), await readFile(validFixture, "utf8").then((content) => content.slice(content.indexOf("# EXECUTION GOAL"), content.indexOf("# Execution Plan"))), "utf8");
    await unlink(resolve(planDirectory, "planner-output.md"));
    expect(run(verifyScript, verifyArguments).status).toBe(1);

    const secondTaskId = "20260712T000000Z-symlink-test";
    const secondPlanDirectory = initializeAndPersist(plansRoot, secondTaskId);
    const externalGoal = resolve(plansRoot, "external-goal.md");
    await writeFile(externalGoal, "external", "utf8");
    await unlink(resolve(secondPlanDirectory, "goal.md"));
    await symlink(externalGoal, resolve(secondPlanDirectory, "goal.md"));
    expect(run(verifyScript, ["--task-id", secondTaskId, "--plans-root", plansRoot]).status).toBe(1);

    const thirdTaskId = "20260712T000000Z-escape-test";
    const thirdPlanDirectory = initializeAndPersist(plansRoot, thirdTaskId);
    const manifestPath = resolve(thirdPlanDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.goal = "../outside.md";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    expect(run(verifyScript, ["--task-id", thirdTaskId, "--plans-root", plansRoot]).status).toBe(1);
  });

  it("rejects invalid revisions and goal status changes that bypass prerequisites", async () => {
    const plansRoot = await createPlansRoot();
    const taskId = "20260712T000000Z-status-test";
    const planDirectory = initializeAndPersist(plansRoot, taskId);
    expect(run(persistScript, ["--task-id", taskId, "--planner-output", validFixture, "--revision", "-1", "--plans-root", plansRoot]).status).toBe(1);
    expect(run(verifyScript, ["--task-id", taskId, "--revision", "-1", "--plans-root", plansRoot]).status).toBe(1);

    const manifestPath = resolve(planDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.goals.find((goal) => goal.id === "G02").status = "passed";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    const result = run(verifyScript, ["--task-id", taskId, "--plans-root", plansRoot]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("prerequisite G01");
  });
});
