import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_CLASSIFICATIONS = Object.freeze(["SIMPLE", "COMPLEX"]);
export const TASK_STATUSES = Object.freeze([
  "planned",
  "in_progress",
  "blocked",
  "awaiting_user",
  "verification_failed",
  "failed",
  "completed",
  "completed_and_archived"
]);
export const GOAL_STATUSES = Object.freeze(["pending", "in_progress", "passed", "failed", "blocked", "skipped"]);
export const TASK_ID_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
export const MAX_TASK_ID_LENGTH = 120;
export const MANIFEST_FILE_REFERENCES = Object.freeze({
  planner_output: "planner-output.md",
  goal: "goal.md",
  plan_index: "plan-index.md",
  decisions: "decisions.md",
  progress: "progress.md"
});

const libraryDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(libraryDirectory, "../../..");
export const defaultPlansRoot = resolve(repositoryRoot, ".codex/runtime/plans");

export function assertTaskId(taskId) {
  if (typeof taskId !== "string" || taskId.length < 3 || taskId.length > MAX_TASK_ID_LENGTH || !TASK_ID_PATTERN.test(taskId)) {
    throw new Error("Task ID must contain 3-120 letters, digits, and single hyphens only.");
  }
  return taskId;
}

export function assertEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) throw new Error(`${label} must be one of: ${allowedValues.join(", ")}.`);
  return value;
}

export function assertContainedPath(parentPath, candidatePath) {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const pathFromParent = relative(parent, candidate);
  if (pathFromParent === "" || pathFromParent === ".." || pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Path escapes its allowed root: ${candidate}`);
  }
  return candidate;
}

export function getPlanDirectory(taskId, plansRoot = defaultPlansRoot) {
  assertTaskId(taskId);
  const root = resolve(plansRoot);
  return assertContainedPath(root, resolve(root, taskId));
}

export function getRevisionDirectory(taskId, revision, plansRoot = defaultPlansRoot) {
  if (!Number.isInteger(revision) || revision < 0) throw new Error("Revision must be a non-negative integer.");
  const planDirectory = getPlanDirectory(taskId, plansRoot);
  return revision === 0 ? planDirectory : assertContainedPath(planDirectory, resolve(planDirectory, "revisions", `r${revision}`));
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export async function atomicWriteText(filePath, content) {
  const target = resolve(filePath);
  const temporaryPath = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, target);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function atomicWriteJson(filePath, value) {
  await atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function ensureRealDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
  const status = await lstat(directoryPath);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`Expected a real directory, not a symlink: ${directoryPath}`);
  }
  return realpath(directoryPath);
}

export async function assertRealRegularFileWithin(rootPath, filePath) {
  const root = await realpath(rootPath);
  const target = assertContainedPath(root, filePath);
  const status = await lstat(target);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Expected a regular, non-symlink file: ${target}`);
  const physicalTarget = await realpath(target);
  assertContainedPath(root, physicalTarget);
  return physicalTarget;
}

export function createInitialManifest({ taskId, title, classification, createdAt = new Date().toISOString() }) {
  assertTaskId(taskId);
  assertEnum(classification, TASK_CLASSIFICATIONS, "Classification");
  if (classification !== "COMPLEX") throw new Error("Only COMPLEX tasks may have a plan manifest.");
  return {
    schema_version: 1,
    task_id: taskId,
    task_title: title || taskId,
    classification,
    status: "planned",
    active_revision: 0,
    active_goal_id: null,
    files: { ...MANIFEST_FILE_REFERENCES },
    hashes: { planner_output: null, goal: null, tasks: {} },
    goals: [],
    running_agents: [],
    verification: {},
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: null
  };
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Manifest must be an object.");
  assertTaskId(manifest.task_id);
  assertEnum(manifest.classification, TASK_CLASSIFICATIONS, "Manifest classification");
  if (manifest.classification !== "COMPLEX") throw new Error("Manifest classification must be COMPLEX.");
  assertEnum(manifest.status, TASK_STATUSES, "Manifest status");
  if (!Number.isInteger(manifest.active_revision) || manifest.active_revision < 0) throw new Error("Manifest active_revision must be a non-negative integer.");
  if (!Array.isArray(manifest.goals) || !Array.isArray(manifest.running_agents)) throw new Error("Manifest goals and running_agents must be arrays.");
  if (!manifest.files || typeof manifest.files !== "object") throw new Error("Manifest files must be an object.");
  for (const [key, expectedValue] of Object.entries(MANIFEST_FILE_REFERENCES)) {
    if (manifest.files[key] !== expectedValue) throw new Error(`Manifest file reference ${key} must be ${expectedValue}.`);
  }
  for (const goal of manifest.goals) {
    if (!goal || typeof goal.id !== "string") throw new Error("Each manifest goal must have an ID.");
    assertEnum(goal.status, GOAL_STATUSES, `Goal ${goal.id} status`);
  }
  return manifest;
}

export function scanMarkdownHeadings(markdown) {
  const headings = [];
  const expression = /^(#{1,6})[ \t]+(.+?)[ \t]*\r?$/gm;
  for (let match = expression.exec(markdown); match; match = expression.exec(markdown)) {
    headings.push({ level: match[1].length, title: match[2].trim(), start: match.index, end: expression.lastIndex });
  }
  return headings;
}

export function extractUniqueMarkdownSection(markdown, title, level = 1) {
  const headings = scanMarkdownHeadings(markdown);
  const matches = headings.filter((heading) => heading.level === level && heading.title === title);
  if (matches.length !== 1) throw new Error(`Expected exactly one level-${level} heading named ${title}; found ${matches.length}.`);
  const heading = matches[0];
  const nextHeading = headings.find((candidate) => candidate.start > heading.start && candidate.level <= level);
  return markdown.slice(heading.start, nextHeading ? nextHeading.start : markdown.length);
}

export function extractGxxSections(markdown) {
  const headings = scanMarkdownHeadings(markdown).filter((heading) => heading.level === 2 && /^G\d+$/.test(heading.title));
  if (headings.length === 0) throw new Error("Planner output must contain at least one level-2 Gxx task heading.");
  const sections = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (sections.has(heading.title)) throw new Error(`Duplicate Gxx heading: ${heading.title}.`);
    const nextHeading = headings.slice(index + 1).find((candidate) => candidate.level <= 2);
    sections.set(heading.title, markdown.slice(heading.start, nextHeading ? nextHeading.start : markdown.length));
  }
  return sections;
}

export function extractPrerequisites(taskSection) {
  const prerequisitesHeading = scanMarkdownHeadings(taskSection).find((heading) => /^prerequisites$/i.test(heading.title));
  if (!prerequisitesHeading) return [];
  const headings = scanMarkdownHeadings(taskSection);
  const nextHeading = headings.find((candidate) => candidate.start > prerequisitesHeading.start && candidate.level <= prerequisitesHeading.level);
  const content = taskSection.slice(prerequisitesHeading.end, nextHeading ? nextHeading.start : taskSection.length);
  return [...new Set([...content.matchAll(/\bG\d+\b/g)].map((match) => match[0]))];
}
