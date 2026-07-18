#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const kib = 1024;

export const bundleTargets = {
  admin: {
    label: "Admin",
    distDir: path.join(repositoryRoot, "apps/admin/dist"),
    maxJsBytes: 500 * kib,
    adminManifest: {
      path: ".vite/manifest.json",
      maxEntryGzipBytes: 300 * kib,
      requiredDynamicEntries: [
        { name: "login", pattern: /pages[\\/]LoginPage|LoginPage/i },
        { name: "crud", pattern: /crud[\\/](CrudPage|RecordFormPage|config)|CrudPage|RecordFormPage/i },
        { name: "detail-editor", pattern: /detail-pages[\\/]DetailPageDesigner|DetailPageDesigner/i },
        { name: "media-or-backup", pattern: /media[\\/]MediaPage|pages[\\/]BackupPage|MediaPage|BackupPage/i }
      ],
      requiredChunkNames: [/framework/i, /antd/i]
    }
  },
  "miniapp-h5": {
    label: "Miniapp H5",
    distDir: path.join(repositoryRoot, "apps/miniapp/dist"),
    maxJsBytes: 620 * kib,
    h5Entrypoint: {
      html: "index.html",
      maxEntryRawBytes: 380 * kib
    }
  },
  "miniapp-weapp": {
    label: "Miniapp WeApp",
    distDir: path.join(repositoryRoot, "apps/miniapp/dist"),
    maxJsBytes: 200 * kib
  }
};

export function formatBytes(bytes) {
  return `${(bytes / kib).toFixed(2)} KiB`;
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    return [fullPath];
  });
}

function gzipSize(filePath) {
  return gzipSync(readFileSync(filePath)).byteLength;
}

export function collectJsAssets(distDir) {
  return walkFiles(distDir)
    .filter((filePath) => filePath.endsWith(".js"))
    .map((filePath) => ({
      file: path.relative(distDir, filePath).split(path.sep).join("/"),
      rawBytes: statSync(filePath).size,
      gzipBytes: gzipSize(filePath)
    }))
    .sort((left, right) => right.rawBytes - left.rawBytes || left.file.localeCompare(right.file));
}

function parseManifest(distDir, manifestPath) {
  const fullPath = path.join(distDir, manifestPath);
  if (!existsSync(fullPath)) {
    return { manifest: null, issue: `missing manifest: ${manifestPath}` };
  }
  return { manifest: JSON.parse(readFileSync(fullPath, "utf8")), issue: null };
}

function manifestChunkLabel(key, chunk) {
  return [key, chunk?.name, chunk?.src, chunk?.file].filter(Boolean).join(" ");
}

function collectStaticEntryFiles(manifest) {
  const files = new Set();
  const visiting = new Set();

  function visit(key) {
    if (visiting.has(key)) return;
    visiting.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    if (typeof chunk.file === "string" && chunk.file.endsWith(".js")) {
      files.add(chunk.file);
    }
    for (const importedKey of chunk.imports ?? []) {
      visit(importedKey);
    }
  }

  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk?.isEntry) visit(key);
  }
  return [...files].sort();
}

function collectDynamicImportLabels(manifest) {
  const dynamicKeys = new Set();
  for (const chunk of Object.values(manifest)) {
    for (const key of chunk?.dynamicImports ?? []) {
      dynamicKeys.add(key);
    }
  }
  return [...dynamicKeys].map((key) => manifestChunkLabel(key, manifest[key]));
}

function analyzeAdminManifest(distDir, config) {
  const result = {
    entryFiles: [],
    entryRawBytes: 0,
    entryGzipBytes: 0,
    dynamicLabels: [],
    issues: []
  };
  const { manifest, issue } = parseManifest(distDir, config.path);
  if (issue) {
    result.issues.push(issue);
    return result;
  }

  result.entryFiles = collectStaticEntryFiles(manifest);
  for (const file of result.entryFiles) {
    const fullPath = path.join(distDir, file);
    if (!existsSync(fullPath)) {
      result.issues.push(`manifest references missing entry asset: ${file}`);
      continue;
    }
    result.entryRawBytes += statSync(fullPath).size;
    result.entryGzipBytes += gzipSize(fullPath);
  }

  if (result.entryGzipBytes > config.maxEntryGzipBytes) {
    result.issues.push(
      `admin static entry gzip ${formatBytes(result.entryGzipBytes)} exceeds ${formatBytes(config.maxEntryGzipBytes)}`
    );
  }

  result.dynamicLabels = collectDynamicImportLabels(manifest);
  for (const required of config.requiredDynamicEntries ?? []) {
    if (!result.dynamicLabels.some((label) => required.pattern.test(label))) {
      result.issues.push(`missing dynamic route chunk for ${required.name}`);
    }
  }

  const allChunkFiles = Object.values(manifest)
    .map((chunk) => chunk?.file)
    .filter((file) => typeof file === "string");
  for (const pattern of config.requiredChunkNames ?? []) {
    if (!allChunkFiles.some((file) => pattern.test(file))) {
      result.issues.push(`missing expected chunk name matching ${pattern}`);
    }
  }

  return result;
}

function parseH5ScriptEntrypoint(distDir, config) {
  const htmlPath = path.join(distDir, config.html);
  const result = {
    entryFiles: [],
    entryRawBytes: 0,
    entryGzipBytes: 0,
    issues: []
  };
  if (!existsSync(htmlPath)) {
    result.issues.push(`missing H5 html entry: ${config.html}`);
    return result;
  }

  const html = readFileSync(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi)]
    .map((match) => match[1].replace(/^\//, ""))
    .filter((value) => !/^https?:\/\//i.test(value));
  result.entryFiles = [...new Set(scripts)].sort();

  for (const file of result.entryFiles) {
    const fullPath = path.join(distDir, file);
    if (!existsSync(fullPath)) {
      result.issues.push(`html references missing entry asset: ${file}`);
      continue;
    }
    result.entryRawBytes += statSync(fullPath).size;
    result.entryGzipBytes += gzipSize(fullPath);
  }

  if (result.entryRawBytes > config.maxEntryRawBytes) {
    result.issues.push(
      `H5 html entry raw ${formatBytes(result.entryRawBytes)} exceeds ${formatBytes(config.maxEntryRawBytes)}`
    );
  }

  return result;
}

export function checkBundleBudget(targetConfig) {
  const assets = collectJsAssets(targetConfig.distDir);
  const issues = [];
  if (!assets.length) {
    issues.push(`no JavaScript assets found in ${targetConfig.distDir}`);
  }
  for (const asset of assets) {
    if (asset.rawBytes > targetConfig.maxJsBytes) {
      issues.push(`${asset.file} raw ${formatBytes(asset.rawBytes)} exceeds ${formatBytes(targetConfig.maxJsBytes)}`);
    }
  }

  let entry = null;
  if (targetConfig.adminManifest) {
    entry = analyzeAdminManifest(targetConfig.distDir, targetConfig.adminManifest);
    issues.push(...entry.issues);
  }
  if (targetConfig.h5Entrypoint) {
    entry = parseH5ScriptEntrypoint(targetConfig.distDir, targetConfig.h5Entrypoint);
    issues.push(...entry.issues);
  }

  return { assets, entry, issues };
}

export function formatBudgetReport(label, result) {
  const lines = [`${label} bundle budget report`, "JS assets:"];
  if (!result.assets.length) {
    lines.push("  (none)");
  } else {
    for (const asset of result.assets) {
      lines.push(`  ${asset.file} | raw ${formatBytes(asset.rawBytes)} | gzip ${formatBytes(asset.gzipBytes)}`);
    }
  }

  if (result.entry) {
    lines.push("Entry closure:");
    lines.push(`  files: ${result.entry.entryFiles.join(", ") || "(none)"}`);
    lines.push(`  raw ${formatBytes(result.entry.entryRawBytes)} | gzip ${formatBytes(result.entry.entryGzipBytes)}`);
    if (result.entry.dynamicLabels?.length) {
      lines.push("Dynamic imports:");
      for (const label of result.entry.dynamicLabels) lines.push(`  ${label}`);
    }
  }

  if (result.issues.length) {
    lines.push("Budget failures:");
    for (const issue of result.issues) lines.push(`  - ${issue}`);
  } else {
    lines.push("Budget check passed.");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const parsed = { target: "", reportOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") parsed.target = argv[++index] ?? "";
    else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else if (arg === "--report-only") parsed.reportOnly = true;
  }
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const targetConfig = bundleTargets[args.target];
  if (!targetConfig) {
    console.error(`Unknown target "${args.target}". Expected one of: ${Object.keys(bundleTargets).join(", ")}`);
    process.exit(2);
  }
  const result = checkBundleBudget(targetConfig);
  console.log(formatBudgetReport(targetConfig.label, result));
  if (result.issues.length && !args.reportOnly) process.exit(1);
}

export function createFixtureDist(files) {
  const directory = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(directory, relativePath);
    mkdirp(path.dirname(fullPath));
    writeFileSync(fullPath, content);
  }
  return {
    directory,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function mkdirp(directory) {
  if (existsSync(directory)) return;
  mkdirSync(directory, { recursive: true });
}
