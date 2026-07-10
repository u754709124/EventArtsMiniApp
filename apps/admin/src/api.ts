import type { ApiResponse } from "@event-arts/shared";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const tokenKey = "eventarts.admin.token";

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
  localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
}

export async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const body = (await response.json()) as ApiResponse<T>;
  if (!body.success) throw new ApiError(body.error.message, body.error.code, response.status);
  return body.data;
}
