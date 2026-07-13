import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taroMock = vi.hoisted(() => {
  const storage = new Map<string, unknown>();
  return {
    ENV_TYPE: { WEB: "WEB", WEAPP: "WEAPP" },
    getEnv: vi.fn(() => "WEAPP"),
    getStorageSync: vi.fn((key: string) => storage.get(key)),
    setStorageSync: vi.fn((key: string, value: unknown) => {
      storage.set(key, value);
    }),
    removeStorageSync: vi.fn((key: string) => {
      storage.delete(key);
    }),
    login: vi.fn(),
    request: vi.fn(),
    storage
  };
});

vi.mock("@tarojs/taro", () => ({ default: taroMock }));

type ApiModule = typeof import("./api");
type RequestOptions = {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
};
type ResponseHeaders = Record<string, string | number | string[] | undefined>;
type ApiBody<T = unknown> =
  | { success: true; data: T; message?: string }
  | { success: false; error: { code: string; message: string } };

const originalNodeEnv = process.env.NODE_ENV;
const sessionStorageKey = "event-arts:client-session:v1";

let api: ApiModule;

function futureIso(seconds = 1_800) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function successBody<T>(data: T): ApiBody<T> {
  return { success: true, data, message: "ok" };
}

function createRequestTask(body: ApiBody, statusCode = 200, header: ResponseHeaders = {}) {
  let rejectTask: (error: unknown) => void = () => undefined;
  const task = new Promise((resolve, reject) => {
    rejectTask = reject;
    queueMicrotask(() => resolve({ data: body, statusCode, header }));
  }) as Promise<unknown> & { abort: ReturnType<typeof vi.fn> };
  task.abort = vi.fn(() => rejectTask(new Error("aborted")));
  return task;
}

function createDeferredRequestTask() {
  let resolveTask: (value: unknown) => void = () => undefined;
  let rejectTask: (error: unknown) => void = () => undefined;
  const task = new Promise((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  }) as Promise<unknown> & { abort: ReturnType<typeof vi.fn> };
  task.abort = vi.fn(() => rejectTask(new Error("aborted")));
  return {
    task,
    resolve(body: ApiBody, statusCode = 200, header: ResponseHeaders = {}) {
      resolveTask({ data: body, statusCode, header });
    }
  };
}

function clientLoginResponse(token: string) {
  return successBody({
    token,
    tokenType: "Bearer",
    expiresInSeconds: 1_800,
    expiresAt: futureIso()
  });
}

function rateLimitedBody(): ApiBody {
  return {
    success: false,
    error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" }
  };
}

function requestPath(options: RequestOptions) {
  return new URL(options.url).pathname;
}

async function waitForRequest(requests: RequestOptions[], pathname: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (requests.some((options) => requestPath(options) === pathname)) return;
    await Promise.resolve();
  }
}

async function loadApiModule() {
  vi.resetModules();
  vi.stubGlobal("__TARO_API_BASE_URL__", "http://api.test");
  taroMock.storage.clear();
  taroMock.getEnv.mockReset().mockReturnValue("WEAPP");
  taroMock.getStorageSync.mockClear();
  taroMock.setStorageSync.mockClear();
  taroMock.removeStorageSync.mockClear();
  taroMock.login.mockReset();
  taroMock.request.mockReset();
  api = await import("./api");
}

beforeEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await loadApiModule();
});

afterEach(() => {
  vi.useRealTimers();
  process.env.NODE_ENV = originalNodeEnv;
  vi.unstubAllGlobals();
});

describe("miniapp client auth request layer", () => {
  it("exchanges wx login code and injects the client bearer token", async () => {
    const requests: RequestOptions[] = [];
    taroMock.login.mockImplementation(({ success }) => {
      success?.({ code: "wx-login-code-1" });
    });
    taroMock.request.mockImplementation((options: RequestOptions) => {
      requests.push(options);
      if (requestPath(options) === "/api/client/auth/wechat") {
        return createRequestTask(clientLoginResponse("client-token-1"));
      }
      return createRequestTask(successBody({ home: true }));
    });

    await api.getHome();

    expect(taroMock.login).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "POST",
      data: { code: "wx-login-code-1" }
    });
    expect(requests[0].header?.Authorization).toBeUndefined();
    expect(requests[1].header?.Authorization).toBe("Bearer client-token-1");
    expect(taroMock.setStorageSync).toHaveBeenCalledWith(
      sessionStorageKey,
      expect.objectContaining({ token: "client-token-1", tokenType: "Bearer" })
    );
  });

  it("merges concurrent protected requests into one login exchange", async () => {
    const authExchange = createDeferredRequestTask();
    const requests: RequestOptions[] = [];
    taroMock.login.mockResolvedValue({ code: "single-flight-code" });
    taroMock.request.mockImplementation((options: RequestOptions) => {
      requests.push(options);
      if (requestPath(options) === "/api/client/auth/wechat") return authExchange.task;
      return createRequestTask(successBody({ ok: true }));
    });

    const homePromise = api.getHome();
    const menuPromise = api.getMenuItems();
    await waitForRequest(requests, "/api/client/auth/wechat");

    expect(taroMock.login).toHaveBeenCalledTimes(1);
    expect(requests.filter((options) => requestPath(options) === "/api/client/auth/wechat")).toHaveLength(1);

    authExchange.resolve(clientLoginResponse("single-flight-token"));
    await Promise.all([homePromise, menuPromise]);

    const protectedRequests = requests.filter((options) => requestPath(options) !== "/api/client/auth/wechat");
    expect(protectedRequests).toHaveLength(2);
    expect(protectedRequests.every((options) => options.header?.Authorization === "Bearer single-flight-token")).toBe(true);
  });

  it("clears an expired client session and retries a 401 once after fresh login", async () => {
    taroMock.storage.set(sessionStorageKey, {
      token: "expired-token",
      tokenType: "Bearer",
      expiresAt: futureIso(),
      expiresAtMs: Date.now() + 1_800_000
    });
    const requests: RequestOptions[] = [];
    taroMock.login.mockResolvedValue({ code: "retry-code" });
    taroMock.request.mockImplementation((options: RequestOptions) => {
      requests.push(options);
      const path = requestPath(options);
      if (path === "/api/client/auth/wechat") return createRequestTask(clientLoginResponse("fresh-token"));
      if (path === "/api/client/home" && requests.filter((item) => requestPath(item) === "/api/client/home").length === 1) {
        return createRequestTask({
          success: false,
          error: { code: "CLIENT_SESSION_EXPIRED", message: "客户端会话已过期" }
        }, 401);
      }
      return createRequestTask(successBody({ home: true }));
    });

    await api.getHome();

    const homeRequests = requests.filter((options) => requestPath(options) === "/api/client/home");
    expect(homeRequests).toHaveLength(2);
    expect(homeRequests[0].header?.Authorization).toBe("Bearer expired-token");
    expect(homeRequests[1].header?.Authorization).toBe("Bearer fresh-token");
    expect(taroMock.login).toHaveBeenCalledTimes(1);
    expect(requests.filter((options) => requestPath(options) === "/api/client/auth/wechat")).toHaveLength(1);
    expect(taroMock.removeStorageSync).toHaveBeenCalledWith(sessionStorageKey);
  });

  it("does not use the explicit H5 login-code adapter in production", async () => {
    const adapter = vi.fn(() => "h5-dev-code");
    process.env.NODE_ENV = "production";
    taroMock.getEnv.mockReturnValue("WEB");
    taroMock.request.mockImplementation(() => createRequestTask(successBody({ unreachable: true })));
    api.configureH5ClientLoginCodeAdapter(adapter);

    await expect(api.getHome()).rejects.toMatchObject({
      code: "WECHAT_LOGIN_UNAVAILABLE"
    });

    expect(adapter).not.toHaveBeenCalled();
    expect(taroMock.request).not.toHaveBeenCalled();
  });
});
