import Taro from "@tarojs/taro";
import type {
  ActivityCaseListItemDto,
  ApiResponse,
  ArticleListResponse,
  ClientHomeResponse,
  ClientWechatLoginResponse,
  MenuItemDto
} from "@event-arts/shared";

declare const __TARO_API_BASE_URL__: string;

const baseUrl = __TARO_API_BASE_URL__;
const clientAuthExchangePath = "/api/client/auth/wechat";
const clientSessionStorageKey = "event-arts:client-session:v1";
const clientSessionExpirySkewMs = 15_000;
const clientLoginRateLimitDefaultCooldownSeconds = 5;
const clientLoginRateLimitMaxCooldownSeconds = 900;

type ClientSession = {
  token: string;
  tokenType: "Bearer";
  expiresAt: string;
  expiresAtMs: number;
};

type WechatLoginResult = { code?: string; errMsg?: string };
type WechatLoginFunction = (options: {
  success?: (result: WechatLoginResult) => void;
  fail?: (error: WechatLoginResult) => void;
}) => Promise<WechatLoginResult> | void;
type H5ClientLoginCodeAdapter = () => string | Promise<string>;

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type AbortableRequest<T> = {
  promise: Promise<T>;
  abort: () => void;
};

let cachedClientSession: ClientSession | null = null;
let clientLoginExchangePromise: Promise<ClientSession> | null = null;
let h5ClientLoginCodeAdapter: H5ClientLoginCodeAdapter | null = null;
let clientLoginCooldownUntilMs = 0;

export function configureH5ClientLoginCodeAdapter(adapter: H5ClientLoginCodeAdapter | null) {
  h5ClientLoginCodeAdapter = adapter;
}

export function clearClientSession() {
  cachedClientSession = null;
  try {
    Taro.removeStorageSync(clientSessionStorageKey);
  } catch {
    // Storage can be unavailable in some H5 test/dev runtimes.
  }
}

function normalizeHeaders(header: Partial<Taro.request.Option>["header"]) {
  return { ...(header || {}) } as Record<string, string>;
}

function getPathname(url: string) {
  try {
    return new URL(url, baseUrl).pathname;
  } catch {
    return url.split("?")[0] || url;
  }
}

function isClientApiRequest(url: string) {
  return getPathname(url).startsWith("/api/client/");
}

function isClientAuthExchangeRequest(url: string) {
  return getPathname(url) === clientAuthExchangePath;
}

function headerValue(headers: unknown, headerName: string) {
  if (!headers || typeof headers !== "object") return undefined;
  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== normalizedHeaderName) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

function parseRetryAfterSeconds(value: unknown) {
  const rawValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(rawValue)) return undefined;
  const seconds = Number(rawValue);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds, clientLoginRateLimitMaxCooldownSeconds);
}

function retryAfterSecondsFromResponse<T>(response: Taro.request.SuccessCallbackResult<ApiResponse<T>>) {
  if (response.statusCode !== 429) return undefined;
  return parseRetryAfterSeconds(headerValue((response as { header?: unknown }).header, "Retry-After"));
}

function clientLoginCooldownSeconds(retryAfterSeconds?: number) {
  return Math.min(
    retryAfterSeconds ?? clientLoginRateLimitDefaultCooldownSeconds,
    clientLoginRateLimitMaxCooldownSeconds
  );
}

function setClientLoginCooldown(retryAfterSeconds?: number) {
  clientLoginCooldownUntilMs = Date.now() + clientLoginCooldownSeconds(retryAfterSeconds) * 1000;
}

function clearClientLoginCooldown() {
  clientLoginCooldownUntilMs = 0;
}

function getClientLoginCooldownRemainingSeconds() {
  const remainingMs = clientLoginCooldownUntilMs - Date.now();
  if (remainingMs <= 0) {
    clearClientLoginCooldown();
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}

function throwIfClientLoginCooldownActive() {
  const retryAfterSeconds = getClientLoginCooldownRemainingSeconds();
  if (retryAfterSeconds <= 0) return;
  throw new ApiRequestError(
    "RATE_LIMITED",
    "登录请求过于频繁，请稍后再试",
    429,
    retryAfterSeconds
  );
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function isH5Runtime() {
  return Taro.getEnv?.() === Taro.ENV_TYPE.WEB;
}

function canUseH5LoginAdapter() {
  return isH5Runtime() && !isProductionRuntime();
}

function normalizeClientSession(response: ClientWechatLoginResponse): ClientSession {
  const expiresAtMs = Date.parse(response.expiresAt);
  return {
    token: response.token,
    tokenType: response.tokenType,
    expiresAt: response.expiresAt,
    expiresAtMs: Number.isFinite(expiresAtMs)
      ? expiresAtMs
      : Date.now() + response.expiresInSeconds * 1000
  };
}

function isUsableClientSession(session: ClientSession | null | undefined): session is ClientSession {
  return Boolean(session?.token && session.tokenType === "Bearer" && session.expiresAtMs - clientSessionExpirySkewMs > Date.now());
}

function readStoredClientSession() {
  if (cachedClientSession) return cachedClientSession;
  try {
    const stored = Taro.getStorageSync<ClientSession>(clientSessionStorageKey);
    if (isUsableClientSession(stored)) {
      cachedClientSession = stored;
      return stored;
    }
  } catch {
    return null;
  }
  return null;
}

function saveClientSession(session: ClientSession) {
  cachedClientSession = session;
  try {
    Taro.setStorageSync(clientSessionStorageKey, session);
  } catch {
    // Keep the in-memory token for the current app lifetime if storage fails.
  }
}

function getGlobalWxLogin() {
  return (globalThis as typeof globalThis & { wx?: { login?: WechatLoginFunction } }).wx?.login;
}

function resolveWechatLogin(login: WechatLoginFunction) {
  return new Promise<WechatLoginResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    try {
      const result = login({
        success: (value) => finish(() => resolve(value)),
        fail: (error) => finish(() => reject(new ApiRequestError("WECHAT_LOGIN_FAILED", error.errMsg || "微信登录失败")))
      });
      if (result && typeof result.then === "function") {
        result.then((value) => finish(() => resolve(value))).catch((error) => {
          finish(() => reject(error));
        });
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function getWechatLoginCode() {
  if (h5ClientLoginCodeAdapter) {
    if (!canUseH5LoginAdapter()) {
      throw new ApiRequestError("WECHAT_LOGIN_UNAVAILABLE", "当前环境不支持微信登录");
    }
    const code = await h5ClientLoginCodeAdapter();
    if (typeof code === "string" && code.trim()) return code.trim();
    throw new ApiRequestError("WECHAT_LOGIN_FAILED", "微信登录失败");
  }

  const taroLogin = (Taro as typeof Taro & { login?: WechatLoginFunction }).login;
  const login = taroLogin || getGlobalWxLogin();
  if (!login) {
    throw new ApiRequestError("WECHAT_LOGIN_UNAVAILABLE", "当前环境不支持微信登录");
  }

  const result = await resolveWechatLogin(login);
  if (typeof result.code === "string" && result.code.trim()) return result.code.trim();
  throw new ApiRequestError("WECHAT_LOGIN_FAILED", result.errMsg || "微信登录失败");
}

function parseApiResponse<T>(response: Taro.request.SuccessCallbackResult<ApiResponse<T>>) {
  const body = response.data;
  if (!body?.success) {
    const error = body?.success === false
      ? body.error
      : { code: "INVALID_RESPONSE", message: "接口响应格式错误" };
    throw new ApiRequestError(error.code, error.message, response.statusCode, retryAfterSecondsFromResponse(response));
  }
  return body.data;
}

function rawRequest<T>(url: string, options: Partial<Taro.request.Option> = {}) {
  const task = Taro.request<ApiResponse<T>>({
    url: `${baseUrl}${url}`,
    method: options.method || "GET",
    data: options.data,
    header: options.header,
    timeout: options.timeout || 10000
  });
  return Promise.resolve(task).then(parseApiResponse<T>);
}

async function exchangeClientSession() {
  const code = await getWechatLoginCode();
  try {
    const response = await rawRequest<ClientWechatLoginResponse>(clientAuthExchangePath, {
      method: "POST",
      data: { code }
    });
    const session = normalizeClientSession(response);
    clearClientLoginCooldown();
    saveClientSession(session);
    return session;
  } catch (error) {
    if (error instanceof ApiRequestError && error.statusCode === 429 && error.code === "RATE_LIMITED") {
      setClientLoginCooldown(error.retryAfterSeconds);
    }
    throw error;
  }
}

async function getClientSession(options: { forceRefresh?: boolean } = {}) {
  if (!options.forceRefresh) {
    const stored = readStoredClientSession();
    if (isUsableClientSession(stored)) return stored;
  } else {
    clearClientSession();
  }

  throwIfClientLoginCooldownActive();
  if (!clientLoginExchangePromise) {
    clientLoginExchangePromise = exchangeClientSession().finally(() => {
      clientLoginExchangePromise = null;
    });
  }
  return clientLoginExchangePromise;
}

function isClientSessionUnauthorized(error: unknown) {
  if (!(error instanceof ApiRequestError)) return false;
  return error.statusCode === 401 && [
    "CLIENT_AUTH_REQUIRED",
    "CLIENT_SESSION_EXPIRED",
    "CLIENT_SESSION_REVOKED"
  ].includes(error.code);
}

async function buildRequestOptions(
  url: string,
  options: Partial<Taro.request.Option>
): Promise<Partial<Taro.request.Option>> {
  if (!isClientApiRequest(url) || isClientAuthExchangeRequest(url)) return options;
  const session = await getClientSession();
  return {
    ...options,
    header: {
      ...normalizeHeaders(options.header),
      Authorization: `${session.tokenType} ${session.token}`
    }
  };
}

function executeRequest<T>(
  url: string,
  options: Partial<Taro.request.Option>,
  setActiveTask: (task: ReturnType<typeof Taro.request<ApiResponse<T>>>) => void
) {
  const task = Taro.request<ApiResponse<T>>({
    url: `${baseUrl}${url}`,
    method: options.method || "GET",
    data: options.data,
    header: options.header,
    timeout: options.timeout || 10000
  });
  setActiveTask(task);
  return Promise.resolve(task).then(parseApiResponse<T>);
}

export function requestWithTask<T>(
  url: string,
  options: Partial<Taro.request.Option> = {}
): AbortableRequest<T> {
  let aborted = false;
  let activeTask: ReturnType<typeof Taro.request<ApiResponse<T>>> | null = null;
  const run = async (hasRetriedClientAuth: boolean): Promise<T> => {
    const requestOptions = await buildRequestOptions(url, options);
    if (aborted) throw new ApiRequestError("REQUEST_ABORTED", "请求已取消");
    try {
      return await executeRequest<T>(url, requestOptions, (task) => {
        activeTask = task;
      });
    } catch (error) {
      if (
        !aborted &&
        !hasRetriedClientAuth &&
        isClientApiRequest(url) &&
        !isClientAuthExchangeRequest(url) &&
        isClientSessionUnauthorized(error)
      ) {
        await getClientSession({ forceRefresh: true });
        return run(true);
      }
      throw error;
    } finally {
      activeTask = null;
    }
  };
  const promise = run(false);
  return {
    promise,
    abort: () => {
      aborted = true;
      const abortable = activeTask as typeof activeTask & { abort?: () => void };
      abortable?.abort?.();
    }
  };
}

export async function request<T>(url: string, options: Partial<Taro.request.Option> = {}) {
  return requestWithTask<T>(url, options).promise;
}

export function getHome() {
  return request<ClientHomeResponse>("/api/client/home");
}

export function getMenuItems() {
  return request<MenuItemDto[]>("/api/client/menu-items");
}

export function getCases(filters: { q?: string; category?: string } = {}) {
  const params: string[] = [];
  const query = filters.q?.trim();
  const category = filters.category?.trim();
  if (query) params.push(`q=${encodeURIComponent(query)}`);
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  const search = params.join("&");
  return request<ActivityCaseListItemDto[]>(`/api/client/cases${search ? `?${search}` : ""}`);
}

export function getArticles(filters: { q?: string; category?: string; page?: number; pageSize?: number } = {}) {
  const params: string[] = [];
  const query = filters.q?.trim();
  const category = filters.category?.trim();
  if (query) params.push(`q=${encodeURIComponent(query)}`);
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (filters.page) params.push(`page=${filters.page}`);
  if (filters.pageSize) params.push(`pageSize=${filters.pageSize}`);
  const search = params.join("&");
  return request<ArticleListResponse>(`/api/client/articles${search ? `?${search}` : ""}`);
}

export function trackPageView(pagePath: string, scene: string) {
  return request("/api/client/track/page-view", {
    method: "POST",
    data: { pagePath, scene }
  });
}
