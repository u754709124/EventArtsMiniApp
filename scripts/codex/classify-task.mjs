#!/usr/bin/env node

import { TASK_CLASSIFICATIONS, assertEnum } from "./lib/plan-run.mjs";

const COMPLEX_PATTERNS = [
  /\b(cross[ -]?module|architecture|data[ -]?flow|public api|schema|migration|security|authori[sz]ation|concurrency|performance|cache|compatibility|deployment|rollback|refactor|regression)\b/i,
  /(跨模块|架构|数据流|公共接口|迁移|安全|授权|并发|性能|缓存|兼容|部署|回滚|重构|回归)/
];
const SIMPLE_PATTERNS = [/\b(typo|spelling|format(?:ting)?|comment|readme heading)\b/i, /(错别字|拼写|格式|注释|标题)/];

function printHelp() {
  console.log(`Usage: node scripts/codex/classify-task.mjs --request <text> [--affected-path <path>]... [--force SIMPLE|COMPLEX]

Writes one JSON object to stdout. Ambiguous requests are classified as COMPLEX;
only a clearly localized, low-risk request is SIMPLE. --force is intended for a
reviewed override and is included in the emitted reasons.`);
}

function parseArguments(argumentsList) {
  const result = { paths: [], request: "", force: null };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--help", "-h"].includes(argument)) return { help: true };
    if (!["--request", "--affected-path", "--force"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    if (argument === "--request") result.request = value;
    if (argument === "--affected-path") result.paths.push(value);
    if (argument === "--force") result.force = assertEnum(value, TASK_CLASSIFICATIONS, "Forced classification");
  }
  if (!result.request.trim()) throw new Error("--request is required.");
  return result;
}

function hasPattern(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyTask({ request, paths = [], force = null }) {
  if (force) return { classification: force, reasons: ["reviewed manual classification override"] };
  const normalizedRequest = request.trim();
  const topLevelPaths = new Set(paths.map((path) => path.split(/[\\/]/)[0]).filter(Boolean));
  if (hasPattern(COMPLEX_PATTERNS, normalizedRequest)) {
    return { classification: "COMPLEX", reasons: ["request contains a consequential complexity signal"] };
  }
  if (topLevelPaths.size > 1) {
    return { classification: "COMPLEX", reasons: ["request affects multiple top-level project areas"] };
  }
  if (hasPattern(SIMPLE_PATTERNS, normalizedRequest) && topLevelPaths.size <= 1) {
    return { classification: "SIMPLE", reasons: ["request is a localized low-risk maintenance edit"] };
  }
  return { classification: "COMPLEX", reasons: ["insufficient evidence to safely classify the request as SIMPLE"] };
}

function main() {
  const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--"));
  if (options.help) {
    printHelp();
    return;
  }
  const result = classifyTask(options);
  console.log(JSON.stringify({ schema_version: 1, request: options.request, affected_paths: options.paths, ...result }));
}

try {
  main();
} catch (error) {
  console.error(`classify-task: ${error.message}`);
  process.exitCode = 1;
}
