import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
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
  const host = process.env.ADMIN_HOST || defaultAdminHost;
  const port = Number.parseInt(process.env.ADMIN_PORT || String(defaultAdminPort), 10);
  const server = createAdminStaticServer();
  server.listen(port, host, () => {
    console.log(`Admin static server listening on http://${host}:${port}/admin/`);
  });
}
