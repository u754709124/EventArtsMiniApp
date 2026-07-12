#!/usr/bin/env node

import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import {
  assertRealRegularFileWithin,
  assertTaskId,
  atomicWriteJson,
  atomicWriteText,
  defaultPlansRoot,
  extractGxxSections,
  extractPrerequisites,
  extractUniqueMarkdownSection,
  getPlanDirectory,
  getRevisionDirectory,
  readJson,
  sha256,
  validateManifest
} from "./lib/plan-run.mjs";

function printHelp() {
  console.log(`Usage: node scripts/codex/persist-planner-output.mjs --task-id <safe-id> --planner-output <file> [--revision <n>] [--plans-root <directory>]

Persists one Planner original, its unique # EXECUTION GOAL section, and its
unique ## Gxx sections without rewriting their text. Existing immutable plan
files are never overwritten.`);
}

function parseArguments(argumentsList) {
  const options = { taskId: null, plannerOutput: null, revision: null, plansRoot: defaultPlansRoot };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--help", "-h"].includes(argument)) return { help: true };
    const key = { "--task-id": "taskId", "--planner-output": "plannerOutput", "--revision": "revision", "--plans-root": "plansRoot" }[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    options[key] = value;
    index += 1;
  }
  assertTaskId(options.taskId);
  if (!options.plannerOutput) throw new Error("--planner-output is required.");
  if (options.revision !== null && !/^\d+$/.test(options.revision)) throw new Error("Revision must be a non-negative integer.");
  options.revision = options.revision === null ? null : Number(options.revision);
  return options;
}

async function assertInputFile(inputPath) {
  const status = await lstat(inputPath);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Planner output must be a regular, non-symlink file: ${inputPath}`);
}

async function assertRealDirectory(directoryPath) {
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  return realpath(directoryPath);
}

async function assertNewImmutableFiles(revisionDirectory, taskIds) {
  const filePaths = ["planner-output.md", "goal.md", ...taskIds.map((taskId) => `tasks/${taskId}.md`)];
  for (const relativePath of filePaths) {
    try {
      await lstat(`${revisionDirectory}/${relativePath}`);
      throw new Error(`Refusing to overwrite immutable plan file: ${relativePath}`);
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
  if (options.help) {
    printHelp();
    return;
  }
  await assertInputFile(options.plannerOutput);
  const plannerOutput = await readFile(options.plannerOutput, "utf8");
  const goal = extractUniqueMarkdownSection(plannerOutput, "EXECUTION GOAL");
  const tasks = extractGxxSections(plannerOutput);
  const planDirectory = await assertRealDirectory(getPlanDirectory(options.taskId, options.plansRoot));
  const manifest = validateManifest(await readJson(`${planDirectory}/manifest.json`));
  if (manifest.task_id !== options.taskId) throw new Error("Task ID does not match the manifest.");
  const revision = options.revision ?? manifest.active_revision;
  if (revision !== manifest.active_revision) throw new Error(`Revision ${revision} is not the active revision ${manifest.active_revision}.`);
  const revisionDirectory = await assertRealDirectory(getRevisionDirectory(options.taskId, revision, options.plansRoot));
  await assertRealRegularFileWithin(planDirectory, `${planDirectory}/manifest.json`);
  await mkdir(`${revisionDirectory}/tasks`, { recursive: true });
  await assertNewImmutableFiles(revisionDirectory, [...tasks.keys()]);

  await atomicWriteText(`${revisionDirectory}/planner-output.md`, plannerOutput);
  await atomicWriteText(`${revisionDirectory}/goal.md`, goal);
  const taskHashes = {};
  const goals = [];
  for (const [taskId, taskSection] of tasks) {
    await atomicWriteText(`${revisionDirectory}/tasks/${taskId}.md`, taskSection);
    taskHashes[taskId] = sha256(taskSection);
    goals.push({ id: taskId, status: "pending", prerequisites: extractPrerequisites(taskSection), implementation_result: null, test_result: null });
  }
  const updatedAt = new Date().toISOString();
  const updatedManifest = {
    ...manifest,
    active_revision: revision,
    active_goal_id: goals[0].id,
    status: "planned",
    goals,
    hashes: { ...manifest.hashes, planner_output: sha256(plannerOutput), goal: sha256(goal), tasks: taskHashes },
    updated_at: updatedAt
  };
  await atomicWriteJson(`${planDirectory}/manifest.json`, updatedManifest);
  console.log(JSON.stringify({ task_id: options.taskId, revision, persisted: true, goal: "goal.md", tasks: [...tasks.keys()] }));
}

main().catch((error) => {
  console.error(`persist-planner-output: ${error.message}`);
  process.exitCode = 1;
});
