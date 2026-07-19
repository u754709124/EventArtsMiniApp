import type {
  AdminAuthIdentityDto,
  AdminPasswordResetPurpose,
  AdminRole,
  AdminUserDto,
  AdminNotificationCreateRequest,
  AdminNotificationCreateResponse,
  AdminNotificationLevel,
  AdminNotificationListResponse,
  ApiResponse,
  BackupCreateRequest,
  BackupCreateResponse,
  BackupDeleteResponse,
  BackupImportPreflightResponse,
  BackupListResponse,
  BackupRestoreAcceptedResponse,
  ScheduledTaskKey,
  ScheduledTaskListResponse,
  ScheduledTaskRunResponse
} from "@event-arts/shared";
import { isAdminLoginPathname, withAdminBasename } from "./routes/admin-paths";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const tokenKey = "eventarts.admin.token";
const identityKey = "eventarts.admin.identity";
let sessionExpiredHandler: (() => void) | null = null;
let handlingSessionExpiry = false;
const sessionSubscribers = new Set<(identity: AdminIdentity | null) => void>();

export type AdminIdentity = AdminAuthIdentityDto;

export type AdminLoginResponse = AdminIdentity & { token: string };

export type AdminUserListResponse = {
  items: AdminUserDto[];
  total: number;
};

export type AdminUserCreateRequest = {
  username: string;
  role: AdminRole;
  permissions?: string[];
  currentPassword: string;
  confirmation: true;
};

export type AdminUserCreateResponse = {
  user: AdminUserDto;
  activationLink: string;
  expiresAt: string;
  revokedSessionCount: number;
  revokedResetTokenCount: number;
};

export type AdminUserUpdateRequest = {
  username?: string;
  role?: AdminRole;
  status?: "enabled" | "disabled";
  currentPassword?: string;
  confirmation?: true;
};

export type AdminUserUpdateResponse = {
  user: AdminUserDto;
  revokedSessionCount: number;
  revokedResetTokenCount: number;
};

export type AdminUserPermissionsUpdateRequest = {
  permissions: string[];
  confirmation?: true;
};

export type AdminUserPermissionsUpdateResponse = AdminUserUpdateResponse;

export type AdminPasswordResetLinkRequest = {
  purpose: AdminPasswordResetPurpose;
  currentPassword: string;
  confirmation: true;
};

export type AdminPasswordResetLinkResponse = {
  purpose: AdminPasswordResetPurpose;
  resetLink: string;
  expiresAt: string;
  revokedSessionCount: number;
  revokedResetTokenCount: number;
};

export type AdminPasswordResetLinksRevokeRequest = {
  purpose?: AdminPasswordResetPurpose;
  currentPassword: string;
  confirmation: true;
};

export type AdminPasswordResetLinksRevokeResponse = {
  revokedResetTokenCount: number;
};

export type AdminPasswordResetConsumeRequest = {
  token: string;
  newPassword: string;
  confirmPassword: string;
};

export type AdminPasswordResetConsumeResponse = {
  purpose: AdminPasswordResetPurpose;
  revokedSessionCount: number;
  revokedResetTokenCount: number;
};

function readIdentity(): AdminIdentity | null {
  if (!getToken()) return null;
  try {
    const value = JSON.parse(localStorage.getItem(identityKey) ?? "null") as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "publicId" in value &&
      "username" in value &&
      "role" in value &&
      "status" in value &&
      "permissions" in value &&
      "delegablePermissions" in value &&
      Number.isSafeInteger((value as AdminIdentity).id) &&
      (value as AdminIdentity).id > 0 &&
      typeof (value as AdminIdentity).publicId === "string" &&
      typeof (value as AdminIdentity).username === "string" &&
      typeof (value as AdminIdentity).role === "string" &&
      typeof (value as AdminIdentity).status === "string" &&
      Array.isArray((value as AdminIdentity).permissions) &&
      Array.isArray((value as AdminIdentity).delegablePermissions)
    ) {
      return value as AdminIdentity;
    }
  } catch {
    // Ignore invalid legacy storage.
  }
  return null;
}

function emitSession(identity: AdminIdentity | null) {
  sessionSubscribers.forEach((subscriber) => subscriber(identity));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export type BackupArchiveDownload = {
  blob: Blob;
  filename: string;
};

export function getToken() {
  return localStorage.getItem(tokenKey);
}

export function setToken(token: string, identity?: AdminIdentity) {
  handlingSessionExpiry = false;
  localStorage.setItem(tokenKey, token);
  if (identity) localStorage.setItem(identityKey, JSON.stringify(identity));
  else localStorage.removeItem(identityKey);
  emitSession(identity ?? readIdentity());
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(identityKey);
  emitSession(null);
}

export function getAdminIdentity() {
  return readIdentity();
}

export function setAdminIdentity(identity: AdminIdentity) {
  if (!getToken()) return;
  localStorage.setItem(identityKey, JSON.stringify(identity));
  emitSession(identity);
}

export function subscribeAdminSession(subscriber: (identity: AdminIdentity | null) => void) {
  sessionSubscribers.add(subscriber);
  return () => {
    sessionSubscribers.delete(subscriber);
  };
}

export function setSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler;
}

function statusSuffix(response: Response) {
  return response.status ? `（HTTP ${response.status}）` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (!isRecord(value)) return false;
  if (value.success === true) return "data" in value;
  if (value.success !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === "string" && typeof value.error.message === "string";
}

function isProtectedAdminPath(path: string) {
  return path.startsWith("/api/admin/") && path !== "/api/admin/auth/login";
}

function handleSessionExpired(path: string, error: ApiError) {
  if (error.status !== 401 || error.code !== "UNAUTHORIZED" || !isProtectedAdminPath(path)) return;
  if (handlingSessionExpiry) return;
  handlingSessionExpiry = true;
  try {
    if (sessionExpiredHandler) {
      sessionExpiredHandler();
    } else if (typeof window !== "undefined" && !isAdminLoginPathname(window.location.pathname)) {
      window.location.replace(withAdminBasename("/login"));
    }
  } finally {
    clearToken();
  }
}

function parseApiResponseText<T>(response: Response, text: string) {
  if (!text.trim()) {
    throw new ApiError(`服务无响应${statusSuffix(response)}`, "EMPTY_RESPONSE", response.status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(`服务返回格式异常${statusSuffix(response)}`, "INVALID_RESPONSE", response.status);
  }

  if (!isApiResponse<T>(parsed)) {
    throw new ApiError(`服务返回格式异常${statusSuffix(response)}`, "INVALID_RESPONSE", response.status);
  }
  return parsed;
}

function apiErrorFromResponseBody<T>(
  path: string,
  response: Response,
  body: ApiResponse<T>,
  options: { handleSessionExpiry?: boolean } = {}
) {
  if (body.success) return null;
  const error = new ApiError(body.error.message, body.error.code, response.status);
  if (options.handleSessionExpiry !== false) handleSessionExpired(path, error);
  return error;
}

function apiErrorFromResponseText<T>(
  path: string,
  response: Response,
  text: string,
  options: { handleSessionExpiry?: boolean } = {}
) {
  return apiErrorFromResponseBody(path, response, parseApiResponseText<T>(response, text), options);
}

function filenameFromContentDisposition(value: string | null) {
  if (!value) return null;
  const filenameStar = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim();
  if (filenameStar) {
    const encoded = filenameStar.replace(/^"(.*)"$/, "$1");
    const utf8Prefix = /^UTF-8''/i;
    try {
      return decodeURIComponent(encoded.replace(utf8Prefix, ""));
    } catch {
      return null;
    }
  }

  const filename = /(?:^|;)\s*filename\s*=\s*("(?:\\"|[^"])*"|[^;]+)/i.exec(value)?.[1]?.trim();
  if (!filename) return null;
  if (filename.startsWith("\"") && filename.endsWith("\"")) {
    return filename.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return filename;
}

function safeFilenameSegment(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, 140);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized) ? normalized : "backup";
}

function safeBackupArchiveFilename(rawFilename: string | null, backupId: string) {
  const fallback = `${safeFilenameSegment(backupId)}.tar.gz`;
  if (!rawFilename) return fallback;
  const normalized = rawFilename
    .normalize("NFKC")
    .trim()
    .replace(/[\p{Cc}/\\:*?"<>|]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/^[._-]+/, "")
    .slice(0, 180);
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/i.test(normalized)) return normalized;
  return fallback;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { handleSessionExpiry?: boolean; includeAuth?: boolean } = {}
) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const token = getToken();
  if (token && options.includeAuth !== false) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    throw new ApiError(`网络请求失败：${message}`, "NETWORK_ERROR", 0);
  }

  const text = await response.text();
  const body = parseApiResponseText<T>(response, text);
  const error = apiErrorFromResponseBody(path, response, body, options);
  if (error) throw error;
  if (body.success) return body.data;
  throw new ApiError(`服务返回格式异常${statusSuffix(response)}`, "INVALID_RESPONSE", response.status);
}

export async function downloadBackupArchive(backupId: string): Promise<BackupArchiveDownload> {
  const path = `/api/admin/backups/${encodeURIComponent(backupId)}/download`;
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { method: "GET", headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    throw new ApiError(`网络请求失败：${message}`, "NETWORK_ERROR", 0);
  }

  if (!response.ok) {
    const text = await response.text();
    const error = apiErrorFromResponseText(path, response, text);
    if (error) throw error;
    throw new ApiError(`服务返回格式异常${statusSuffix(response)}`, "INVALID_RESPONSE", response.status);
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new ApiError(`下载内容读取失败${statusSuffix(response)}`, "INVALID_RESPONSE", response.status);
  }
  return {
    blob,
    filename: safeBackupArchiveFilename(
      filenameFromContentDisposition(response.headers.get("content-disposition")),
      backupId
    )
  };
}

export async function restoreAdminIdentity() {
  if (!getToken()) return null;
  const identity = await request<AdminIdentity>("/api/admin/auth/me");
  setAdminIdentity(identity);
  return identity;
}

export function persistAdminNotification(payload: AdminNotificationCreateRequest) {
  return request<AdminNotificationCreateResponse>("/api/admin/notifications", {
    method: "POST",
    body: JSON.stringify(payload)
  }, { handleSessionExpiry: false });
}

export function listAdminNotifications(page = 1, pageSize = 20, options: { level?: AdminNotificationLevel } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (options.level) params.set("level", options.level);
  return request<AdminNotificationListResponse>(`/api/admin/notifications?${params}`);
}

export function listBackups() {
  return request<BackupListResponse>("/api/admin/backups");
}

export function createBackup(payload: BackupCreateRequest = {}) {
  return request<BackupCreateResponse>("/api/admin/backups", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteBackup(backupId: string) {
  return request<BackupDeleteResponse>(`/api/admin/backups/${encodeURIComponent(backupId)}`, {
    method: "DELETE",
    body: JSON.stringify({ backupId, confirmation: "DELETE_BACKUP" })
  });
}

export function importBackupArchive(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  return request<BackupImportPreflightResponse>("/api/admin/backups/import", {
    method: "POST",
    body: formData
  });
}

export function restoreBackup(backupId: string) {
  return request<BackupRestoreAcceptedResponse>(`/api/admin/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST",
    body: JSON.stringify({ backupId, confirmation: "RESTORE_FULL_BACKUP" })
  });
}

export function listAdminUsers() {
  return request<AdminUserListResponse>("/api/admin/users");
}

export function createAdminUser(payload: AdminUserCreateRequest) {
  return request<AdminUserCreateResponse>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAdminUser(publicId: string, payload: AdminUserUpdateRequest) {
  return request<AdminUserUpdateResponse>(`/api/admin/users/${encodeURIComponent(publicId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function updateAdminUserPermissions(publicId: string, payload: AdminUserPermissionsUpdateRequest) {
  return request<AdminUserPermissionsUpdateResponse>(`/api/admin/users/${encodeURIComponent(publicId)}/permissions`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function issueAdminPasswordResetLink(publicId: string, payload: AdminPasswordResetLinkRequest) {
  return request<AdminPasswordResetLinkResponse>(`/api/admin/users/${encodeURIComponent(publicId)}/reset-links`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function revokeAdminPasswordResetLinks(publicId: string, payload: AdminPasswordResetLinksRevokeRequest) {
  return request<AdminPasswordResetLinksRevokeResponse>(
    `/api/admin/users/${encodeURIComponent(publicId)}/reset-links/revoke`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function consumeAdminPasswordResetLink(payload: AdminPasswordResetConsumeRequest) {
  return request<AdminPasswordResetConsumeResponse>("/api/admin/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload)
  }, { handleSessionExpiry: false, includeAuth: false });
}

export function listScheduledTasks() {
  return request<ScheduledTaskListResponse>("/api/admin/scheduled-tasks");
}

export function runScheduledTask(taskKey: ScheduledTaskKey) {
  return request<ScheduledTaskRunResponse>(
    `/api/admin/scheduled-tasks/${encodeURIComponent(taskKey)}/run`,
    { method: "POST" }
  );
}
