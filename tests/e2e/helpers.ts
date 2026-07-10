import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const apiBase = "http://127.0.0.1:3001";

export async function adminToken(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/api/admin/auth/login`, {
    data: { username: "admin", password: "admin123456" }
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

export async function clientApi<T>(request: APIRequestContext, path: string) {
  const response = await request.get(`${apiBase}${path}`);
  const body = await response.json();
  if (!body.success) {
    throw new Error(body.error?.message ?? `Client API failed: ${path}`);
  }
  return body.data as T;
}

export async function loginAdminUi(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("admin123456");
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
  await page.getByTestId(testid).click();
  const target = visibleSelectOption(page, option);
  await expect(target).toBeVisible();
  await target.click();
}

export async function waitForToast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).last()).toBeVisible();
}

export async function fillNumber(page: Page, testid: string, value: number) {
  await fillControl(page.getByTestId(testid), String(value));
}
