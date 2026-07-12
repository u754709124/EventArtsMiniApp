#!/usr/bin/env node

import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_AGENT_FILES = [
  "planner.toml",
  "complex_implementer_high.toml",
  "complex_implementer_xhigh.toml",
  "test_rerunner.toml"
];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectAgentsDirectory = resolve(scriptDirectory, "../../.codex/agents");

function printHelp() {
  console.log(`Usage: node scripts/codex/sync-agent-config.mjs --check|--apply

Synchronize the version-controlled .codex/agents templates into CODEX_HOME/agents.
--check  Report drift without writing and exit 1 when synchronization is needed.
--apply  Create/update only the canonical agent files using atomic replacement.

CODEX_HOME defaults to ~/.codex. Existing extra files are never deleted.`);
}

function parseMode(argumentsList) {
  if (argumentsList.length !== 1 || !["--check", "--apply"].includes(argumentsList[0])) {
    if (argumentsList.length === 1 && ["--help", "-h"].includes(argumentsList[0])) return "help";
    throw new Error("Expected exactly one of --check or --apply. Use --help for usage.");
  }
  return argumentsList[0].slice(2);
}

function assertChildPath(parent, child) {
  const childPath = relative(parent, child);
  if (childPath === "" || childPath.startsWith("..") || childPath.includes("../")) {
    throw new Error(`Refusing path outside its expected directory: ${child}`);
  }
}

async function assertRegularFile(filePath) {
  const status = await lstat(filePath);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Expected a regular, non-symlink file: ${filePath}`);
  }
}

async function ensureRealDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  }
  return realpath(directoryPath);
}

async function assertRealDirectory(directoryPath) {
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  }
  return realpath(directoryPath);
}

async function targetExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isInSync(sourcePath, targetPath) {
  if (!(await targetExists(targetPath))) return false;
  await assertRegularFile(targetPath);
  const [source, target] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
  return source.equals(target);
}

async function atomicallyCopy(sourcePath, targetPath) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "help") {
    printHelp();
    return;
  }

  let codeHome = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"));
  let agentsDirectory = resolve(codeHome, "agents");
  assertChildPath(codeHome, agentsDirectory);
  const sourceDirectory = await assertRealDirectory(projectAgentsDirectory);

  if (mode === "apply") {
    codeHome = await ensureRealDirectory(codeHome);
    agentsDirectory = resolve(codeHome, "agents");
    assertChildPath(codeHome, agentsDirectory);
  }

  const entries = [];
  for (const fileName of CANONICAL_AGENT_FILES) {
    const sourcePath = resolve(sourceDirectory, fileName);
    assertChildPath(sourceDirectory, sourcePath);
    await assertRegularFile(sourcePath);
    entries.push({ fileName, sourcePath, targetPath: resolve(agentsDirectory, fileName) });
  }

  if (mode === "check") {
    const drifted = [];
    for (const entry of entries) {
      assertChildPath(agentsDirectory, entry.targetPath);
      if (!(await isInSync(entry.sourcePath, entry.targetPath))) drifted.push(entry.fileName);
    }
    if (drifted.length === 0) {
      console.log(`Agent templates are synchronized in ${agentsDirectory}.`);
      return;
    }
    console.error(`Agent template drift: ${drifted.join(", ")}. Run with --apply to synchronize.`);
    process.exitCode = 1;
    return;
  }

  const targetDirectory = await ensureRealDirectory(agentsDirectory);
  assertChildPath(codeHome, targetDirectory);
  const updated = [];
  for (const entry of entries) {
    const targetPath = resolve(targetDirectory, basename(entry.fileName));
    assertChildPath(targetDirectory, targetPath);
    if (!(await isInSync(entry.sourcePath, targetPath))) {
      if (await targetExists(targetPath)) await assertRegularFile(targetPath);
      await atomicallyCopy(entry.sourcePath, targetPath);
      updated.push(entry.fileName);
    }
  }
  console.log(updated.length === 0 ? "Agent templates already synchronized." : `Synchronized: ${updated.join(", ")}.`);
}

main().catch((error) => {
  console.error(`sync-agent-config: ${error.message}`);
  process.exitCode = 1;
});
