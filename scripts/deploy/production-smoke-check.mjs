import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../..");
const defaultEnvFilePath = path.join(repositoryRoot, ".env");
const defaultNginxTemplatePath = path.join(repositoryRoot, "deploy/nginx/eventarts-miniapp.conf.template");

export function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hashIndex = value.search(/\s+#/);
      if (hashIndex >= 0) value = value.slice(0, hashIndex).trimEnd();
    }
    values[key] = value.replace(/\\n/g, "\n");
  }
  return values;
}

export function isLoopbackHost(value) {
  const host = value.trim().toLowerCase();
  if (host === "localhost") return true;
  if (net.isIPv4(host)) return host.split(".")[0] === "127";
  if (net.isIPv6(host)) return host === "::1" || host === "0:0:0:0:0:0:0:1";
  return false;
}

export function extractNginxUpstreams(template) {
  const upstreams = [];
  const upstreamPattern = /upstream\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}/g;
  let upstreamMatch;

  while ((upstreamMatch = upstreamPattern.exec(template))) {
    const [, name, block] = upstreamMatch;
    const serverPattern = /^\s*server\s+(\[[^\]]+\]|[^:\s;]+):(\d+)\s*;/gm;
    let serverMatch;
    while ((serverMatch = serverPattern.exec(block))) {
      const [, rawHost, rawPort] = serverMatch;
      upstreams.push({
        name,
        host: rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost,
        port: Number.parseInt(rawPort, 10)
      });
    }
  }

  return upstreams;
}

function loadEnv(envFilePath, processEnv) {
  const fileEnv = existsSync(envFilePath) ? parseEnvFile(readFileSync(envFilePath, "utf8")) : {};
  const definedProcessEnv = Object.fromEntries(
    Object.entries(processEnv).filter((entry) => entry[1] !== undefined)
  );
  return { ...fileEnv, ...definedProcessEnv };
}

export function runProductionSmokeCheck(options = {}) {
  const envFilePath = options.envFilePath ?? defaultEnvFilePath;
  const nginxTemplatePath = options.nginxTemplatePath ?? defaultNginxTemplatePath;
  const env = loadEnv(envFilePath, options.processEnv ?? process.env);
  const nginxTemplate = readFileSync(nginxTemplatePath, "utf8");
  const upstreams = extractNginxUpstreams(nginxTemplate);
  const issues = [];

  const expectedHosts = [
    ["API_HOST", env.API_HOST || "127.0.0.1"],
    ["ADMIN_HOST", env.ADMIN_HOST || "127.0.0.1"]
  ];
  for (const [name, value] of expectedHosts) {
    if (!isLoopbackHost(value)) {
      issues.push(`${name} must be loopback for production reverse-proxy deployment; got ${value}`);
    }
  }

  const expectedUpstreams = new Set(["eventarts_admin", "eventarts_api"]);
  for (const name of expectedUpstreams) {
    if (!upstreams.some((upstream) => upstream.name === name)) {
      issues.push(`Nginx template is missing upstream ${name}`);
    }
  }
  for (const upstream of upstreams) {
    if (!isLoopbackHost(upstream.host)) {
      issues.push(`Nginx upstream ${upstream.name} must use loopback; got ${upstream.host}:${upstream.port}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    checked: {
      envFilePath,
      nginxTemplatePath,
      hosts: Object.fromEntries(expectedHosts),
      upstreams
    },
    manualChecks: [
      "Run nginx -t on the target server before reload.",
      "Verify target firewall/security-group rules do not expose API_PORT or ADMIN_PORT publicly.",
      "Verify public traffic reaches the app only through HTTPS Nginx routes /admin, /api, and /uploads."
    ]
  };
}

function isEntryPoint() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  const result = runProductionSmokeCheck();
  if (!result.ok) {
    console.error("Production smoke-check failed:");
    for (const issue of result.issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    console.log("Production smoke-check passed: configured API/Admin hosts and Nginx upstreams are loopback.");
  }
  console.log("Manual deployment checks still required:");
  for (const check of result.manualChecks) console.log(`- ${check}`);
}
