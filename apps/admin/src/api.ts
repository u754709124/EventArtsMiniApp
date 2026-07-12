import type {
  ApiResponse,
  BackupCreateRequest,
  BackupCreateResponse,
  BackupDeleteResponse,
  BackupImportPreflightResponse,
  BackupListResponse,
  BackupRestoreAcceptedResponse
} from "@event-arts/shared";
import { isAdminLoginPathname, withAdminBasename } from "./routes/admin-paths";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const tokenKey = "eventarts.admin.token";
let sessionExpiredHandler: (() => void) | null = null;
let handlingSessionExpiry = false;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function getToken() {
  return localStorage.getItem(tokenKey);
}

export function setToken(token: string) {
  handlingSessionExpiry = false;
  localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
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
  clearToken();
  if (handlingSessionExpiry) return;
  handlingSessionExpiry = true;
  if (sessionExpiredHandler) {
    sessionExpiredHandler();
    return;
  }
  if (typeof window !== "undefined" && !isAdminLoginPathname(window.location.pathname)) {
    window.location.replace(withAdminBasename("/login"));
  }
}

export async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    throw new ApiError(`网络请求失败：${message}`, "NETWORK_ERROR", 0);
  }

  const text = await response.text();
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

  const body = parsed;
  if (!body.success) {
    const error = new ApiError(body.error.message, body.error.code, response.status);
    handleSessionExpired(path, error);
    throw error;
  }
  return body.data;
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
