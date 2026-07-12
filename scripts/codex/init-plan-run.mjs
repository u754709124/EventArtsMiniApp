#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import {
  TASK_CLASSIFICATIONS,
  assertEnum,
  assertTaskId,
  atomicWriteJson,
  atomicWriteText,
  createInitialManifest,
  defaultPlansRoot,
  ensureRealDirectory,
  getPlanDirectory
} from "./lib/plan-run.mjs";

function printHelp() {
  console.log(`Usage: node scripts/codex/init-plan-run.mjs --task-id <safe-id> --classification COMPLEX [--title <title>] [--plans-root <directory>]

Initializes a new COMPLEX-task runtime directory. SIMPLE tasks intentionally do
not create any runtime directory. --plans-root is for controlled local testing.`);
}

function parseArguments(argumentsList) {
  const options = { taskId: null, classification: null, title: "", plansRoot: defaultPlansRoot };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--help", "-h"].includes(argument)) return { help: true };
    const key = { "--task-id": "taskId", "--classification": "classification", "--title": "title", "--plans-root": "plansRoot" }[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    options[key] = value;
    index += 1;
  }
  assertTaskId(options.taskId);
  assertEnum(options.classification, TASK_CLASSIFICATIONS, "Classification");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.classification === "SIMPLE") {
    console.log(JSON.stringify({ schema_version: 1, task_id: options.taskId, classification: "SIMPLE", initialized: false }));
    return;
  }

  const plansRoot = await ensureRealDirectory(options.plansRoot);
  const planDirectory = getPlanDirectory(options.taskId, plansRoot);
  try {
    await mkdir(planDirectory);
  } catch (error) {
    if (error && error.code === "EEXIST") throw new Error(`Plan directory already exists for task ID: ${options.taskId}`);
    throw error;
  }

  try {
    for (const directory of ["tasks", "handoffs", "results", "revisions"]) {
      await mkdir(getPlanDirectory(options.taskId, plansRoot) + `/${directory}`);
    }
    const manifest = createInitialManifest({ taskId: options.taskId, title: options.title, classification: options.classification });
    await atomicWriteJson(`${planDirectory}/manifest.json`, manifest);
    await atomicWriteText(`${planDirectory}/progress.md`, `# Current State\n\n- Task ID: ${options.taskId}\n- Task status: planned\n- Active goal: none\n- Next required action: persist Planner output\n`);
  } catch (error) {
    throw new Error(`Plan initialization stopped after creating ${planDirectory}; preserve it for recovery: ${error.message}`);
  }
  console.log(JSON.stringify({ schema_version: 1, task_id: options.taskId, classification: "COMPLEX", initialized: true, plan_directory: planDirectory }));
}

main().catch((error) => {
  console.error(`init-plan-run: ${error.message}`);
  process.exitCode = 1;
});
