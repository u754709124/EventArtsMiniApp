// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AdminIdentity,
  ApiError,
  clearToken,
  consumeAdminPasswordResetLink,
  createBackup,
  createAdminUser,
  deleteBackup,
  downloadBackupArchive,
  getAdminIdentity,
  getToken,
  importBackupArchive,
  issueAdminPasswordResetLink,
  listAdminUsers,
  request,
  revokeAdminPasswordResetLinks,
  restoreBackup,
  setSessionExpiredHandler,
  setToken,
  updateAdminUser,
  updateAdminUserPermissions
} from "./api";

function identity(overrides: Partial<AdminIdentity> = {}): AdminIdentity {
  return {
    id: 7,
    publicId: "11111111-1111-4111-8111-111111111111",
    username: "unit-admin",
    role: "SUPER_ADMIN",
    status: "enabled",
    permissions: [
      "dashboard",
      "site-config",
      "announcements",
      "banners",
      "menu-items",
      "artists",
      "cases",
      "articles",
      "detail-pages",
      "media-assets",
      "user-management",
      "backups",
      "change-password",
      "scheduled-tasks",
      "system-config"
    ],
    delegablePermissions: [
      "dashboard",
      "site-config",
      "announcements",
      "banners",
      "menu-items",
      "artists",
      "cases",
      "articles",
      "detail-pages",
      "media-assets"
    ],
    ...overrides
  };
}

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
    const oldIdentity = identity({ username: "old-admin" });
    setToken("expired-token", oldIdentity);
    setSessionExpiredHandler(handler);
    stubFetch(new Response(JSON.stringify({
      success: false,
      error: { code: "UNAUTHORIZED", message: "登录已失效" }
    }), { status: 401 }));

    handler.mockImplementation(() => {
      expect(getAdminIdentity()).toEqual(oldIdentity);
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
    const firstIdentity = identity({ id: 1, username: "first" });
    setToken("first-token", firstIdentity);
    expect(getAdminIdentity()).toEqual(firstIdentity);
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

  it("downloads backup attachments with bearer auth and a safe filename", async () => {
    setToken("download-token");
    const archive = new Blob(["archive"], { type: "application/gzip" });
    const fetchMock = stubFetch(new Response(archive, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": "attachment; filename=\"backup-20260712.tar.gz\""
      }
    }));

    const result = await downloadBackupArchive("backup-20260712");
    expect(result.filename).toBe("backup-20260712.tar.gz");
    expect(result.blob.size).toBeGreaterThan(0);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/backups/backup-20260712/download");
    expect((init.headers as Headers).get("authorization")).toBe("Bearer download-token");
    expect(url).not.toContain("download-token");

    fetchMock.mockResolvedValueOnce(new Response(archive, {
      status: 200,
      headers: { "Content-Disposition": "attachment; filename=\"../../token.txt\"" }
    }));
    await expect(downloadBackupArchive("backup-safe")).resolves.toMatchObject({
      filename: "backup-safe.tar.gz"
    });
  });

  it("uses the existing session-expiry path for failed binary downloads", async () => {
    const handler = vi.fn();
    setToken("expired-download-token", identity({ id: 9, username: "expired" }));
    setSessionExpiredHandler(handler);
    stubFetch(new Response(JSON.stringify({
      success: false,
      error: { code: "UNAUTHORIZED", message: "登录已失效" }
    }), { status: 401 }));

    await expect(downloadBackupArchive("backup-20260712")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401
    });
    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls admin user management endpoints without persisting reset links", async () => {
    const resetLink = "http://127.0.0.1:3001/admin/reset-password#token=" + "R".repeat(43);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { resetLink, revokedResetTokenCount: 1 },
      message: "ok"
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setToken("admin-user-token", identity());

    await listAdminUsers();
    expect((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[0]).toBe("/api/admin/users");

    await createAdminUser({
      username: "new-user",
      role: "USER",
      permissions: ["media-assets"],
      currentPassword: "Current-Password-1!",
      confirmation: true
    });
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))).toMatchObject({
      username: "new-user",
      role: "USER",
      permissions: ["media-assets"],
      confirmation: true
    });

    await updateAdminUser("22222222-2222-4222-8222-222222222222", {
      status: "disabled",
      confirmation: true
    });
    expect((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[0])
      .toBe("/api/admin/users/22222222-2222-4222-8222-222222222222");

    await updateAdminUserPermissions("22222222-2222-4222-8222-222222222222", {
      permissions: ["media-assets"],
      confirmation: true
    });
    expect((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[0])
      .toBe("/api/admin/users/22222222-2222-4222-8222-222222222222/permissions");

    await issueAdminPasswordResetLink("22222222-2222-4222-8222-222222222222", {
      purpose: "recovery",
      currentPassword: "Current-Password-1!",
      confirmation: true
    });
    expect(JSON.stringify(localStorage)).not.toContain(resetLink);
    expect(JSON.stringify(sessionStorage)).not.toContain(resetLink);

    await revokeAdminPasswordResetLinks("22222222-2222-4222-8222-222222222222", {
      currentPassword: "Current-Password-1!",
      confirmation: true
    });
    expect((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[0])
      .toBe("/api/admin/users/22222222-2222-4222-8222-222222222222/reset-links/revoke");
  });

  it("consumes public reset tokens without attaching bearer auth", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { purpose: "recovery", revokedSessionCount: 1, revokedResetTokenCount: 1 },
      message: "ok"
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setToken("stale-admin-token", identity());

    await consumeAdminPasswordResetLink({
      token: "T".repeat(43),
      newPassword: "Next-Password-1!",
      confirmPassword: "Next-Password-1!"
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/auth/reset-password");
    expect((init.headers as Headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual({
      token: "T".repeat(43),
      newPassword: "Next-Password-1!",
      confirmPassword: "Next-Password-1!"
    });
  });
});
