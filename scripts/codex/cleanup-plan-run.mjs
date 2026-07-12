#!/usr/bin/env node

import { lstat, realpath, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertContainedPath, assertRealRegularFileWithin, assertTaskId, defaultPlansRoot, getPlanDirectory, readJson, validateManifest } from "./lib/plan-run.mjs";

function printHelp() {
  console.log(`Usage: node scripts/codex/cleanup-plan-run.mjs --task-id <safe-id> [--plans-root <directory>] [--dry-run|--execute]

Defaults to dry-run. --execute removes only the selected completed plan directory
after all Goals, verification records, agents, and completion documentation pass.`);
}

function parseArguments(argumentsList) {
  const options = { plansRoot: defaultPlansRoot, execute: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--help", "-h"].includes(argument)) return { help: true };
    if (argument === "--dry-run") continue;
    if (argument === "--execute") {
      options.execute = true;
      continue;
    }
    const key = { "--task-id": "taskId", "--plans-root": "plansRoot" }[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    options[key] = value;
    index += 1;
  }
  assertTaskId(options.taskId);
  return options;
}

async function assertRealDirectory(directoryPath) {
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  return realpath(directoryPath);
}

async function assertCleanupEligible(manifest) {
  if (manifest.status !== "completed") throw new Error("Cleanup requires a completed task.");
  if (!manifest.goals.every((goal) => goal.status === "passed" && goal.implementation_result && goal.test_result)) throw new Error("Cleanup requires every Goal to pass with recorded results.");
  if (manifest.running_agents.length > 0) throw new Error("Cleanup is blocked by running agents.");
  const verificationEntries = Object.values(manifest.verification);
  if (!manifest.verification.final || verificationEntries.length === 0 || !verificationEntries.every((entry) => entry.status === "passed")) {
    throw new Error("Cleanup requires all verification records, including final, to pass.");
  }
  if (!manifest.completion || !manifest.completion.documentation) throw new Error("Cleanup requires a recorded completion document.");
  await assertRealRegularFileWithin(resolve(process.cwd()), resolve(process.cwd(), manifest.completion.documentation));
}

async function main() {
  const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
  if (options.help) {
    printHelp();
    return;
  }
  const root = await assertRealDirectory(options.plansRoot);
  const target = getPlanDirectory(options.taskId, root);
  const targetStatus = await lstat(target);
  if (!targetStatus.isDirectory() || targetStatus.isSymbolicLink()) throw new Error(`Expected a real task directory, not a symlink: ${target}`);
  const realTarget = await realpath(target);
  assertContainedPath(root, realTarget);
  if (dirname(realTarget) !== root) throw new Error("Cleanup target must be exactly one task directory below the plans root.");
  const manifest = validateManifest(await readJson(`${realTarget}/manifest.json`));
  if (manifest.task_id !== options.taskId) throw new Error("Task ID does not match manifest.");
  await assertCleanupEligible(manifest);
  if (!options.execute) {
    console.log(JSON.stringify({ task_id: options.taskId, dry_run: true, removable: realTarget }));
    return;
  }
  await rm(realTarget, { recursive: true, force: false, maxRetries: 0 });
  console.log(JSON.stringify({ task_id: options.taskId, removed: true }));
}

main().catch((error) => {
  console.error(`cleanup-plan-run: ${error.message}`);
  process.exitCode = 1;
});
