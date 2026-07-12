#!/usr/bin/env node

import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  GOAL_STATUSES,
  assertRealRegularFileWithin,
  assertTaskId,
  atomicWriteJson,
  atomicWriteText,
  defaultPlansRoot,
  getPlanDirectory,
  getRevisionDirectory,
  readJson,
  validateManifest
} from "./lib/plan-run.mjs";

const GOAL_TRANSITIONS = Object.freeze({
  pending: ["in_progress", "blocked", "failed"],
  in_progress: ["passed", "blocked", "failed"],
  blocked: ["in_progress", "failed"],
  passed: [],
  failed: [],
  skipped: []
});
const ACTIONS = new Set(["goal", "result", "agent-start", "agent-finish", "verification", "complete", "recover", "create-revision"]);

function printHelp() {
  console.log(`Usage: node scripts/codex/update-plan-state.mjs --action <action> [options]

Actions:
  goal --task-id ID --goal G01 --status in_progress|passed|blocked|failed
  result --task-id ID --goal G01 --result results/G01-result.md --test-result <text>
         or, for active revision N > 0:
         --result revisions/rN/results/G01-result.md
  agent-start --task-id ID --agent-id ID --role ROLE --goal G01
  agent-finish --task-id ID --agent-id ID --outcome passed|failed
  verification --task-id ID --name NAME --status passed|failed [--command TEXT]
  complete --task-id ID --documentation <existing repository-relative file>
  create-revision --task-id ID --revision N --planner-approved
  recover [--task-id ID] [--plans-root DIRECTORY]

Each mutating action atomically updates manifest.json and the concise progress.md.
Recovery never mutates state; it stops on multiple candidates without --task-id.`);
}

function parseArguments(argumentsList) {
  const options = { plansRoot: defaultPlansRoot, plannerApproved: false };
  const flags = new Set(["--planner-approved"]);
  const keys = {
    "--action": "action", "--task-id": "taskId", "--goal": "goalId", "--status": "status", "--result": "result", "--test-result": "testResult",
    "--agent-id": "agentId", "--role": "role", "--outcome": "outcome", "--name": "name", "--command": "command", "--documentation": "documentation",
    "--revision": "revision", "--plans-root": "plansRoot"
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--help", "-h"].includes(argument)) return { help: true };
    if (flags.has(argument)) {
      options.plannerApproved = true;
      continue;
    }
    const key = keys[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    options[key] = value;
    index += 1;
  }
  if (!ACTIONS.has(options.action)) throw new Error(`--action must be one of: ${[...ACTIONS].join(", ")}.`);
  if (options.action !== "recover") assertTaskId(options.taskId);
  if (options.action === "recover" && options.taskId) assertTaskId(options.taskId);
  if (options.revision !== undefined && !/^\d+$/.test(options.revision)) throw new Error("Revision must be a non-negative integer.");
  if (options.revision !== undefined) options.revision = Number(options.revision);
  return options;
}

async function assertRealDirectory(directoryPath) {
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  return realpath(directoryPath);
}

async function loadRun(taskId, plansRoot) {
  const planDirectory = await assertRealDirectory(getPlanDirectory(taskId, plansRoot));
  const manifestPath = await assertRealRegularFileWithin(planDirectory, `${planDirectory}/manifest.json`);
  const manifest = validateManifest(await readJson(manifestPath));
  if (manifest.task_id !== taskId) throw new Error("Task ID does not match manifest.");
  return { planDirectory, plansRoot: dirname(planDirectory), manifestPath, manifest };
}

function getGoal(manifest, goalId) {
  const goal = manifest.goals.find((candidate) => candidate.id === goalId);
  if (!goal) throw new Error(`Unknown Goal: ${goalId}.`);
  return goal;
}

function assertPassedPrerequisites(manifest, goal) {
  for (const prerequisiteId of goal.prerequisites) {
    const prerequisite = getGoal(manifest, prerequisiteId);
    if (prerequisite.status !== "passed") throw new Error(`Goal ${goal.id} requires ${prerequisiteId} to pass first.`);
  }
}

function progressText(manifest) {
  const goalRows = manifest.goals.map((goal) => `| ${goal.id} | ${goal.status} | ${goal.implementation_result || ""} | ${goal.test_result || ""} |`).join("\n");
  return `# Current State\n\n- Task ID: ${manifest.task_id}\n- Active revision: ${manifest.active_revision}\n- Task status: ${manifest.status}\n- Active goal: ${manifest.active_goal_id || "none"}\n- Running agents: ${manifest.running_agents.length}\n- Last update: ${manifest.updated_at}\n\n# Goal Status\n\n| Goal | Status | Implementation result | Test result |\n| --- | --- | --- | --- |\n${goalRows}\n`;
}

async function saveRun(run, nextManifest) {
  const normalized = { ...nextManifest, updated_at: new Date().toISOString() };
  await atomicWriteJson(run.manifestPath, normalized);
  await atomicWriteText(`${run.planDirectory}/progress.md`, progressText(normalized));
  return normalized;
}

async function updateGoal(run, options) {
  if (!GOAL_STATUSES.includes(options.status)) throw new Error("Goal status is invalid.");
  const goal = getGoal(run.manifest, options.goalId);
  if (!GOAL_TRANSITIONS[goal.status].includes(options.status)) throw new Error(`Illegal Goal transition: ${goal.status} -> ${options.status}.`);
  if (["in_progress", "passed"].includes(options.status)) assertPassedPrerequisites(run.manifest, goal);
  const goals = run.manifest.goals.map((candidate) => candidate.id === goal.id ? { ...candidate, status: options.status } : candidate);
  const taskStatus = options.status === "failed" ? "failed" : options.status === "blocked" ? "blocked" : options.status === "in_progress" ? "in_progress" : run.manifest.status;
  const next = { ...run.manifest, status: taskStatus, active_goal_id: options.status === "passed" ? run.manifest.active_goal_id : goal.id, goals };
  return saveRun(run, next);
}

async function registerResult(run, options) {
  const goal = getGoal(run.manifest, options.goalId);
  if (goal.status !== "passed") throw new Error(`Goal ${goal.id} must pass before registering its result.`);
  if (goal.implementation_result || goal.test_result) throw new Error(`Goal ${goal.id} already has a recorded result.`);
  const allowedResultPaths = [`results/${goal.id}-result.md`];
  if (run.manifest.active_revision > 0) {
    allowedResultPaths.push(`revisions/r${run.manifest.active_revision}/results/${goal.id}-result.md`);
  }
  if (!allowedResultPaths.includes(options.result || "")) {
    throw new Error(`Result path must be one of: ${allowedResultPaths.join(", ")}.`);
  }
  if (!options.testResult) throw new Error("--test-result is required when registering a result.");
  await assertRealRegularFileWithin(run.planDirectory, `${run.planDirectory}/${options.result}`);
  const goals = run.manifest.goals.map((candidate) => candidate.id === goal.id ? { ...candidate, implementation_result: options.result, test_result: options.testResult } : candidate);
  return saveRun(run, { ...run.manifest, goals });
}

async function startAgent(run, options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(options.agentId || "")) throw new Error("Agent ID is invalid.");
  if (!options.role) throw new Error("--role is required.");
  const goal = getGoal(run.manifest, options.goalId);
  if (goal.status !== "in_progress") throw new Error(`Goal ${goal.id} must be in_progress before an agent starts.`);
  if (run.manifest.running_agents.length > 0) throw new Error("Only one write-capable agent may run at a time.");
  const agent = { id: options.agentId, role: options.role, goal_id: goal.id, started_at: new Date().toISOString() };
  return saveRun(run, { ...run.manifest, running_agents: [agent] });
}

async function finishAgent(run, options) {
  if (!["passed", "failed"].includes(options.outcome)) throw new Error("Agent outcome must be passed or failed.");
  const agent = run.manifest.running_agents.find((candidate) => candidate.id === options.agentId);
  if (!agent) throw new Error(`No running agent named ${options.agentId}.`);
  const completed = { ...agent, outcome: options.outcome, finished_at: new Date().toISOString() };
  const history = [...(run.manifest.agent_history || []), completed];
  const next = { ...run.manifest, running_agents: [], agent_history: history };
  if (options.outcome === "failed") next.status = "blocked";
  return saveRun(run, next);
}

async function registerVerification(run, options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/.test(options.name || "")) throw new Error("Verification name is invalid.");
  if (!["passed", "failed"].includes(options.status)) throw new Error("Verification status must be passed or failed.");
  const verification = { ...run.manifest.verification, [options.name]: { status: options.status, command: options.command || null, recorded_at: new Date().toISOString() } };
  return saveRun(run, { ...run.manifest, verification });
}

async function completeTask(run, options) {
  if (!options.documentation) throw new Error("--documentation is required before task completion.");
  const documentationPath = resolve(process.cwd(), options.documentation);
  await assertRealRegularFileWithin(resolve(process.cwd()), documentationPath);
  if (run.manifest.running_agents.length > 0) throw new Error("Cannot complete a task with running agents.");
  if (!run.manifest.goals.every((goal) => goal.status === "passed" && goal.implementation_result && goal.test_result)) {
    throw new Error("Every Goal must pass and have implementation and test results before completion.");
  }
  const verificationEntries = Object.values(run.manifest.verification);
  if (!run.manifest.verification.final || verificationEntries.length === 0 || !verificationEntries.every((entry) => entry.status === "passed")) {
    throw new Error("All verification records, including final, must pass before completion.");
  }
  return saveRun(run, {
    ...run.manifest,
    status: "completed",
    completed_at: new Date().toISOString(),
    completion: { documentation: options.documentation, recorded_at: new Date().toISOString() }
  });
}

async function createRevision(run, options) {
  if (!options.plannerApproved) throw new Error("Creating a revision requires --planner-approved.");
  if (run.manifest.running_agents.length > 0) throw new Error("Cannot create a revision with running agents.");
  if (options.revision !== run.manifest.active_revision + 1) throw new Error("New revision must be exactly one greater than the active revision.");
  const revisionDirectory = getRevisionDirectory(run.manifest.task_id, options.revision, run.plansRoot);
  try {
    await mkdir(revisionDirectory);
  } catch (error) {
    if (error && error.code === "EEXIST") throw new Error(`Revision ${options.revision} already exists.`);
    throw error;
  }
  for (const directory of ["tasks", "handoffs", "results"]) await mkdir(`${revisionDirectory}/${directory}`);
  return saveRun(run, {
    ...run.manifest,
    status: "planned",
    active_revision: options.revision,
    active_goal_id: null,
    goals: [],
    hashes: { planner_output: null, goal: null, tasks: {} },
    revision_history: [...(run.manifest.revision_history || []), { revision: options.revision, planner_approved: true, created_at: new Date().toISOString() }]
  });
}

async function recover(options) {
  const root = await assertRealDirectory(options.plansRoot);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const taskId = assertTaskId(entry.name);
      if (options.taskId && taskId !== options.taskId) continue;
      const run = await loadRun(taskId, root);
      if (run.manifest.status !== "completed") candidates.push({ task_id: taskId, status: run.manifest.status, active_goal_id: run.manifest.active_goal_id });
    } catch {
      // Ignore non-run directories; a selected task is handled below with a specific error.
    }
  }
  if (options.taskId && candidates.length === 0) throw new Error(`No recoverable task found for ${options.taskId}.`);
  if (!options.taskId && candidates.length > 1) throw new Error(`Multiple recoverable tasks found; select one with --task-id: ${candidates.map((candidate) => candidate.task_id).join(", ")}.`);
  console.log(JSON.stringify({ recovered: false, candidates }));
}

async function main() {
  const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.action === "recover") {
    await recover(options);
    return;
  }
  const run = await loadRun(options.taskId, options.plansRoot);
  const next = await ({
    goal: () => updateGoal(run, options),
    result: () => registerResult(run, options),
    "agent-start": () => startAgent(run, options),
    "agent-finish": () => finishAgent(run, options),
    verification: () => registerVerification(run, options),
    complete: () => completeTask(run, options),
    "create-revision": () => createRevision(run, options)
  })[options.action]();
  console.log(JSON.stringify({ task_id: next.task_id, action: options.action, status: next.status, active_goal_id: next.active_goal_id }));
}

main().catch((error) => {
  console.error(`update-plan-state: ${error.message}`);
  process.exitCode = 1;
});
