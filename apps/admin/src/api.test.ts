// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearToken, request, setToken } from "./api";

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
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
      body: JSON.stringify({ username: "admin", password: "admin123456" })
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
});
