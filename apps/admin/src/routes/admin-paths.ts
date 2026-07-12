export const ADMIN_BASENAME = "/admin";
export const ADMIN_BASE_PATH = `${ADMIN_BASENAME}/`;

export function withAdminBasename(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === ADMIN_BASENAME || normalized.startsWith(ADMIN_BASE_PATH)) return normalized;
  return `${ADMIN_BASENAME}${normalized}`;
}

export function stripAdminBasename(pathname: string) {
  if (pathname === ADMIN_BASENAME) return "/";
  if (pathname.startsWith(ADMIN_BASE_PATH)) return pathname.slice(ADMIN_BASENAME.length) || "/";
  return pathname;
}

export function isAdminLoginPathname(pathname: string) {
  return stripAdminBasename(pathname) === "/login";
}
