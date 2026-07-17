import { createHash } from "node:crypto";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const apiBase = "http://127.0.0.1:3001";
export const adminPath = (path: string) => `/admin${path.startsWith("/") ? path : `/${path}`}`;
const clientAuthTokens = new WeakMap<APIRequestContext, Promise<string>>();

function e2eAdminCredentials() {
  const username = process.env.E2E_ADMIN_USERNAME;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD must be provided by playwright.config.ts");
  }
  return { username, password };
}

export async function adminToken(request: APIRequestContext) {
  const credentials = e2eAdminCredentials();
  const response = await request.post(`${apiBase}/api/admin/auth/login`, {
    data: credentials
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return String(body.data.token);
}

export async function adminApi<T>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: unknown
) {
  const token = await adminToken(request);
  const response = await request.fetch(`${apiBase}${path}`, {
    method,
    data,
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  if (!body.success) {
    throw new Error(body.error?.message ?? `Admin API failed: ${method} ${path}`);
  }
  return body.data as T;
}

export async function adminUploadMedia(
  request: APIRequestContext,
  input: { resourceName: string; name: string; mimeType: string; buffer: Buffer }
) {
  const token = await adminToken(request);
  const response = await request.post(`${apiBase}/api/admin/media-assets/upload`, {
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      resourceName: input.resourceName,
      md5: createHash("md5").update(input.buffer).digest("hex"),
      tags: "[]",
      file: { name: input.name, mimeType: input.mimeType, buffer: input.buffer }
    }
  });
  const body = await response.json();
  if (!body.success) throw new Error(body.error?.message ?? "Media upload failed");
  return body.data.asset as { id: number; resourceName: string };
}

async function clientAuthToken(request: APIRequestContext) {
  let tokenPromise = clientAuthTokens.get(request);
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const response = await request.post(`${apiBase}/api/client/auth/wechat`, {
        data: { code: `e2e-login-${process.pid}-${Date.now()}` }
      });
      const body = await response.json();
      if (!body.success) {
        throw new Error(body.error?.message ?? "Client auth exchange failed");
      }
      return String(body.data.token);
    })();
    clientAuthTokens.set(request, tokenPromise);
  }
  return tokenPromise;
}

function isClientSessionError(body: { success?: boolean; error?: { code?: string } }) {
  return body.success === false && [
    "CLIENT_AUTH_REQUIRED",
    "CLIENT_SESSION_EXPIRED",
    "CLIENT_SESSION_REVOKED"
  ].includes(body.error?.code ?? "");
}

export async function clientApi<T>(request: APIRequestContext, path: string) {
  const token = await clientAuthToken(request);
  let response = await request.get(`${apiBase}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  let body = await response.json();
  if (isClientSessionError(body)) {
    clientAuthTokens.delete(request);
    const freshToken = await clientAuthToken(request);
    response = await request.get(`${apiBase}${path}`, {
      headers: { authorization: `Bearer ${freshToken}` }
    });
    body = await response.json();
  }
  if (!body.success) {
    throw new Error(body.error?.message ?? `Client API failed: ${path}`);
  }
  return body.data as T;
}

export async function loginAdminUi(page: Page) {
  const credentials = e2eAdminCredentials();
  await page.goto(adminPath("/login"));
  await page.getByTestId("login-username").fill(credentials.username);
  await page.getByTestId("login-password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("dashboard-pv-today")).toBeVisible();
}

export async function fillControl(locator: Locator, value: string) {
  const nested = locator.locator("input, textarea").first();
  if (await nested.count()) {
    await nested.fill(value);
    return;
  }
  await locator.fill(value);
}

export function visibleSelectOption(page: Page, option: string | RegExp) {
  return page.locator(".ant-select-dropdown:visible").last().locator(".ant-select-item-option-content").filter({ hasText: option }).first();
}

export async function selectOption(page: Page, testid: string, option: string | RegExp) {
  if (testid === "status-select") {
    const control = page.getByTestId(testid);
    const desired = typeof option === "string" ? option : option.source;
    const shouldEnable = desired.includes("启用") || desired.includes("enabled");
    const checked = await control.getAttribute("aria-checked");
    if ((checked === "true") !== shouldEnable) await control.click();
    return;
  }
  await page.getByTestId(testid).click();
  const target = visibleSelectOption(page, option);
  await expect(target).toBeVisible();
  await target.click();
}

export async function chooseMediaFromLibrary(
  page: Page,
  testid: string,
  resourceName: string | RegExp,
  multiple = false,
  mediaType: "image" | "video" = "image"
) {
  await page.getByTestId(`${testid}-add`).click();
  await page.getByTestId("media-action-library").click();
  const modal = page.locator('[data-testid="media-library-modal"]:visible');
  await expect(modal).toBeVisible();
  if (mediaType === "video") await modal.getByRole("tab", { name: "视频" }).click();
  const search = modal.getByLabel("搜索资源");
  await search.fill(mediaSearchText(resourceName));
  await search.press("Enter");
  const option = modal.getByRole("button", { name: resourceName });
  if (mediaType === "image") {
    await expect(option.locator("img")).toHaveCSS("object-fit", "contain");
  }
  await option.click();
  if (multiple) await expect(modal).toBeHidden();
  else await expect(page.getByTestId(`${testid}-preview`)).toBeVisible();
}

function mediaSearchText(resourceName: string | RegExp) {
  return typeof resourceName === "string" ? resourceName : resourceName.source.replace(/\\(.)/g, "$1");
}

export async function chooseDetailMediaFromLibrary(
  page: Page,
  trigger: Locator,
  resourceName: string | RegExp
) {
  await trigger.click();
  const modal = page.locator('[data-testid="media-library-modal"]:visible');
  await expect(modal).toBeVisible();
  const search = modal.getByLabel("搜索资源");
  await search.fill(mediaSearchText(resourceName));
  await search.press("Enter");
  const optionName = typeof resourceName === "string"
    ? `选择 ${resourceName}`
    : new RegExp(`选择 .*${resourceName.source}`);
  const option = modal.getByRole("button", { name: optionName }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(modal).toBeHidden();
}

export async function waitForToast(page: Page, text: string | RegExp) {
  await expect(page.getByTestId("notification-toast").filter({ hasText: text }).last()).toBeVisible();
}

export async function fillNumber(page: Page, testid: string, value: number) {
  await fillControl(page.getByTestId(testid), String(value));
}
