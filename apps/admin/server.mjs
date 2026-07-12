import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultAdminHost = "127.0.0.1";
export const defaultAdminPort = 4173;
export const adminBasePath = "/admin/";

const rootDir = dirname(fileURLToPath(import.meta.url));
const defaultDistDir = join(rootDir, "dist");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".map", "application/json; charset=utf-8"]
]);

export class AdminServerConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdminServerConfigError";
  }
}

function isValidHost(value) {
  if (value === "localhost") return true;
  if (net.isIP(value)) return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value);
}

export function isLoopbackHost(value) {
  const host = value.trim().toLowerCase();
  if (host === "localhost") return true;

  if (net.isIPv4(host)) {
    return host.split(".")[0] === "127";
  }

  if (net.isIPv6(host)) {
    return host === "::1" || host === "0:0:0:0:0:0:0:1";
  }

  return false;
}

export function resolveAdminServerConfig(processEnv = process.env) {
  const host = (processEnv.ADMIN_HOST || defaultAdminHost).trim();
  const rawPort = processEnv.ADMIN_PORT || String(defaultAdminPort);
  const port = Number.parseInt(rawPort, 10);
  const env = processEnv.NODE_ENV || "development";
  const issues = [];

  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push("ADMIN_PORT must be an integer between 1 and 65535");
  }
  if (!isValidHost(host)) {
    issues.push(`ADMIN_HOST is not a valid hostname or IP address: ${host}`);
  }
  if (env === "production" && !isLoopbackHost(host)) {
    issues.push("ADMIN_HOST must be a loopback address in production; use Nginx as the public entrypoint");
  }
  if (issues.length) {
    throw new AdminServerConfigError(`Invalid Admin server configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  }

  return { env, host, port };
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isInside(parent, child) {
  const relative = child.slice(parent.length);
  return child === parent || (relative.startsWith(sep) && !relative.includes(`..${sep}`));
}

async function serveFile(res, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    send(res, 404, "Not found");
    return;
  }
  const type = contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": String(fileStat.size)
  });
  createReadStream(filePath).pipe(res);
}

async function fileResponse(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return { statusCode: 404, body: "Not found" };
  }
  const type = contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
  return {
    statusCode: 200,
    filePath,
    headers: {
      "content-type": type,
      "content-length": String(fileStat.size)
    }
  };
}

function looksLikeStaticAsset(pathname) {
  return pathname.startsWith(`${adminBasePath}assets/`) || extname(pathname) !== "";
}

export async function resolveAdminStaticRequest(requestUrl, options = {}) {
  const distDir = resolve(options.distDir ?? process.env.ADMIN_DIST_DIR ?? defaultDistDir);
  const indexFile = resolve(distDir, "index.html");

  if (!requestUrl) {
    return { statusCode: 400, body: "Bad request" };
  }

  const url = new URL(requestUrl, "http://127.0.0.1");
  if (url.pathname === "/admin") {
    return {
      statusCode: 308,
      body: "Redirecting to /admin/",
      headers: { location: `/admin/${url.search}` }
    };
  }

  if (!url.pathname.startsWith(adminBasePath)) {
    return { statusCode: 404, body: "Not found" };
  }

  if (!existsSync(indexFile)) {
    return { statusCode: 500, body: "Admin dist/index.html is missing. Run pnpm --filter admin build first." };
  }

  const decoded = safeDecode(url.pathname.slice(adminBasePath.length));
  if (decoded === null) {
    return { statusCode: 400, body: "Bad request" };
  }

  const relativePath = decoded || "index.html";
  const candidate = resolve(distDir, relativePath);
  if (!isInside(distDir, candidate)) {
    return { statusCode: 403, body: "Forbidden" };
  }

  if (existsSync(candidate)) {
    return fileResponse(candidate);
  }

  if (looksLikeStaticAsset(url.pathname)) {
    return { statusCode: 404, body: "Not found" };
  }

  return fileResponse(indexFile);
}

export function createAdminStaticServer(options = {}) {
  return createServer(async (req, res) => {
    try {
      const response = await resolveAdminStaticRequest(req.url, options);
      if (response.filePath) {
        await serveFile(res, response.filePath);
        return;
      }
      send(res, response.statusCode, response.body, response.headers);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      send(res, 500, message);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { host, port } = resolveAdminServerConfig();
    const server = createAdminStaticServer();
    server.listen(port, host, () => {
      console.log(`Admin static server listening on http://${host}:${port}/admin/`);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
