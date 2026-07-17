// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  clearToken,
  createBackup,
  deleteBackup,
  getAdminIdentity,
  getToken,
  importBackupArchive,
  request,
  restoreBackup,
  setSessionExpiredHandler,
  setToken
} from "./api";

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  setSessionExpiredHandler(null);
  clearToken();
  vi.unstubAllGlobals();
});

describe("admin API client", () => {
  it("parses shared success responses and sends JSON auth headers", async () => {
    setToken("stored-token");
    const fetchMock = stubFetch(new Response(JSON.stringify({
      success: true,
      data: { token: "next-token" },
      message: "ok"
    }), { status: 200 }));

    await expect(request<{ token: string }>("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "unit-admin", password: "UnitOnlyPassword#1" })
    })).resolves.toEqual({ token: "next-token" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toBeDefined();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer stored-token");
  });

  it("preserves API failure messages and codes", async () => {
    stubFetch(new Response(JSON.stringify({
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" }
    }), { status: 401 }));

    await expect(request("/api/admin/auth/login", { method: "POST" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "用户名或密码错误",
      status: 401
    });
  });

  it("clears expired protected sessions without treating login failures as expiry", async () => {
    const handler = vi.fn();
    setToken("expired-token", { id: 7, username: "old-admin" });
    setSessionExpiredHandler(handler);
    stubFetch(new Response(JSON.stringify({
      success: false,
      error: { code: "UNAUTHORIZED", message: "登录已失效" }
    }), { status: 401 }));

    handler.mockImplementation(() => {
      expect(getAdminIdentity()).toEqual({ id: 7, username: "old-admin" });
    });
    await expect(request("/api/admin/dashboard/overview")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401
    });
    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(getAdminIdentity()).toBeNull();

    stubFetch(new Response(JSON.stringify({
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" }
    }), { status: 401 }));
    await expect(request("/api/admin/auth/login", { method: "POST" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS"
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("clears a stale stored identity when a token is set without one", () => {
    setToken("first-token", { id: 1, username: "first" });
    expect(getAdminIdentity()).toEqual({ id: 1, username: "first" });
    setToken("legacy-token");
    expect(getAdminIdentity()).toBeNull();
  });

  it("turns empty responses into readable API errors", async () => {
    stubFetch(new Response("", { status: 502 }));

    await expect(request("/api/admin/auth/login", { method: "POST" })).rejects.toMatchObject({
      code: "EMPTY_RESPONSE",
      message: "服务无响应（HTTP 502）",
      status: 502
    });
  });

  it("turns non-JSON responses into readable API errors", async () => {
    stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));

    await expect(request("/api/admin/auth/login", { method: "POST" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "服务返回格式异常（HTTP 502）",
      status: 502
    });
  });

  it("wraps fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    await expect(request("/api/admin/auth/login", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    await expect(request("/api/admin/auth/login", { method: "POST" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "网络请求失败：Failed to fetch",
      status: 0
    });
  });

  it("calls backup management endpoints with explicit confirmations", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { backupId: "backup-20260712" },
      message: "ok"
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteBackup("backup-20260712");
    const deleteCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(deleteCall[0]).toBe("/api/admin/backups/backup-20260712");
    const deleteInit = deleteCall[1];
    expect(deleteInit.method).toBe("DELETE");
    expect(JSON.parse(String(deleteInit.body))).toEqual({
      backupId: "backup-20260712",
      confirmation: "DELETE_BACKUP"
    });

    fetchMock.mockClear();
    await restoreBackup("backup-20260712");
    const restoreCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(restoreCall[0]).toBe("/api/admin/backups/backup-20260712/restore");
    const restoreInit = restoreCall[1];
    expect(restoreInit.method).toBe("POST");
    expect(JSON.parse(String(restoreInit.body))).toEqual({
      backupId: "backup-20260712",
      confirmation: "RESTORE_FULL_BACKUP"
    });
  });

  it("creates backups with notes and imports archives as form data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { backup: { id: "backup-20260712" } },
      message: "ok"
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createBackup({ note: "发布前检查点" });
    const createCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(createCall[0]).toBe("/api/admin/backups");
    const createInit = createCall[1];
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(String(createInit.body))).toEqual({ note: "发布前检查点" });
    expect((createInit.headers as Headers).get("content-type")).toBe("application/json");

    fetchMock.mockClear();
    const file = new File(["backup"], "backup.tar.gz", { type: "application/gzip" });
    await importBackupArchive(file);
    const importCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(importCall[0]).toBe("/api/admin/backups/import");
    const importInit = importCall[1];
    expect(importInit.method).toBe("POST");
    expect(importInit.body).toBeInstanceOf(FormData);
    expect((importInit.headers as Headers).get("content-type")).toBeNull();
  });
});
