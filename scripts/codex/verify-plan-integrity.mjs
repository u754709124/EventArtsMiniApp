#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import {
  MANIFEST_FILE_REFERENCES,
  assertContainedPath,
  assertRealRegularFileWithin,
  assertTaskId,
  defaultPlansRoot,
  extractGxxSections,
  extractUniqueMarkdownSection,
  getPlanDirectory,
  getRevisionDirectory,
  readJson,
  sha256,
  validateManifest
} from "./lib/plan-run.mjs";

function printHelp() {
  console.log(`Usage: node scripts/codex/verify-plan-integrity.mjs --task-id <safe-id> [--revision <n>] [--plans-root <directory>]

Verifies manifest state, approved file references, immutable hashes, Planner
section uniqueness, task extraction, prerequisites, revisions, and path safety.`);
}

function parseArguments(argumentsList) {
  const options = { taskId: null, revision: null, plansRoot: defaultPlansRoot };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--help", "-h"].includes(argument)) return { help: true };
    const key = { "--task-id": "taskId", "--revision": "revision", "--plans-root": "plansRoot" }[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    options[key] = value;
    index += 1;
  }
  assertTaskId(options.taskId);
  if (options.revision !== null && !/^\d+$/.test(options.revision)) throw new Error("Revision must be a non-negative integer.");
  options.revision = options.revision === null ? null : Number(options.revision);
  return options;
}

async function assertNoSymlink(directoryPath) {
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  return realpath(directoryPath);
}

async function readVerifiedFile(rootPath, relativePath, expectedHash) {
  const filePath = assertContainedPath(rootPath, `${rootPath}/${relativePath}`);
  const realFilePath = await assertRealRegularFileWithin(rootPath, filePath);
  const content = await readFile(realFilePath, "utf8");
  if (sha256(content) !== expectedHash) throw new Error(`SHA-256 mismatch for ${relativePath}.`);
  return content;
}

function validateGoalState(manifest) {
  const goals = new Map();
  for (const goal of manifest.goals) {
    if (goals.has(goal.id)) throw new Error(`Duplicate manifest goal ID: ${goal.id}.`);
    if (!Array.isArray(goal.prerequisites)) throw new Error(`Goal ${goal.id} prerequisites must be an array.`);
    goals.set(goal.id, goal);
  }
  if (manifest.active_goal_id !== null && !goals.has(manifest.active_goal_id)) throw new Error("Manifest active_goal_id is not a known goal.");
  for (const goal of goals.values()) {
    for (const prerequisiteId of goal.prerequisites) {
      const prerequisite = goals.get(prerequisiteId);
      if (!prerequisite) throw new Error(`Goal ${goal.id} references missing prerequisite ${prerequisiteId}.`);
      if (["in_progress", "passed"].includes(goal.status) && prerequisite.status !== "passed") {
        throw new Error(`Goal ${goal.id} cannot be ${goal.status} before prerequisite ${prerequisiteId} passes.`);
      }
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
  if (options.help) {
    printHelp();
    return;
  }
  const planDirectory = getPlanDirectory(options.taskId, options.plansRoot);
  const safePlanDirectory = await assertNoSymlink(planDirectory);
  const manifest = validateManifest(await readJson(`${safePlanDirectory}/manifest.json`));
  if (manifest.task_id !== options.taskId) throw new Error("Task ID does not match the manifest.");
  for (const [key, expected] of Object.entries(MANIFEST_FILE_REFERENCES)) {
    if (manifest.files[key] !== expected) throw new Error(`Manifest uses a non-whitelisted ${key} path.`);
  }
  const revision = options.revision ?? manifest.active_revision;
  if (revision !== manifest.active_revision) throw new Error(`Revision ${revision} is not the active revision ${manifest.active_revision}.`);
  const revisionDirectory = await assertNoSymlink(getRevisionDirectory(options.taskId, revision, options.plansRoot));
  if (revisionDirectory !== safePlanDirectory) assertContainedPath(safePlanDirectory, revisionDirectory);
  const plannerOutput = await readVerifiedFile(revisionDirectory, "planner-output.md", manifest.hashes.planner_output);
  const goal = await readVerifiedFile(revisionDirectory, "goal.md", manifest.hashes.goal);
  const extractedGoal = extractUniqueMarkdownSection(plannerOutput, "EXECUTION GOAL");
  if (goal !== extractedGoal) throw new Error("Goal file does not match the verbatim Planner Goal section.");
  const tasks = extractGxxSections(plannerOutput);
  const expectedTaskIds = [...tasks.keys()];
  if (Object.keys(manifest.hashes.tasks).length !== expectedTaskIds.length) throw new Error("Manifest task hash set does not match Planner tasks.");
  for (const [taskId, taskSection] of tasks) {
    if (manifest.hashes.tasks[taskId] !== sha256(taskSection)) throw new Error(`Manifest task hash mismatch for ${taskId}.`);
    const storedTask = await readVerifiedFile(revisionDirectory, `tasks/${taskId}.md`, manifest.hashes.tasks[taskId]);
    if (storedTask !== taskSection) throw new Error(`Stored task ${taskId} does not match Planner output.`);
  }
  if (manifest.goals.length !== expectedTaskIds.length || !expectedTaskIds.every((taskId) => manifest.goals.some((goalItem) => goalItem.id === taskId))) {
    throw new Error("Manifest goals do not match the persisted Gxx task set.");
  }
  validateGoalState(manifest);
  console.log(JSON.stringify({ task_id: options.taskId, revision, valid: true, tasks: expectedTaskIds }));
}

main().catch((error) => {
  console.error(`verify-plan-integrity: ${error.message}`);
  process.exitCode = 1;
});
