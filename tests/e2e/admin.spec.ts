import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminMenuCatalog, type AdminUserDto, type DashboardOverviewResponse, type EdgeOneConfigResponse, type ScheduledTaskDto } from "@event-arts/shared";
import sharp from "sharp";
import { adminApi, adminPath, adminToken, apiBase, chooseDetailMediaFromLibrary, chooseMediaFromLibrary, fillControl, fillNumber, loginAdminUi, selectOption, visibleSelectOption, waitForToast } from "./helpers";

test.describe.configure({ mode: "serial" });

type DetailPageSummary = { id: number; name: string; type: string; typeLabel: string; referenceCount: number };
type MediaAssetSummary = { id: number; resourceName: string; url: string; width: number | null; height: number | null };
type BackupSummary = {
  id: string;
  formatVersion: number;
  backupKind?: "manual" | "automatic" | "restore_snapshot" | "imported";
  dataScope?: "full" | "non_identity";
  note: string | null;
  database: { size: number };
  uploadFileCount: number;
};

function assetUrl(url: string) {
  return new URL(url, apiBase).href;
}

function edgeOneReadyOverview(seed: number): DashboardOverviewResponse {
  return {
    todayUniqueUsers: seed,
    weekDailyUniqueUsers: seed + 1,
    monthDailyUniqueUsers: seed + 2,
    edgeOne: {
      status: "ready",
      zoneId: "zone-e2e",
      fetchedAt: "2026-07-16T08:00:00.000Z",
      last24Hours: {
        startTime: "2026-07-15T08:00:00.000Z",
        endTime: "2026-07-16T08:00:00.000Z",
        trafficBytes: seed * 1_000_000_000,
        requestCount: seed * 1_000_000
      },
      package: {
        planId: "plan-e2e",
        planType: "prepaid",
        planStatus: "normal",
        periodStart: "2026-07-01T00:00:00.000+08:00",
        periodEnd: "2026-08-01T00:00:00.000+08:00",
        trafficUsedBytes: seed * 2_000_000_000,
        trafficCapacityBytes: seed * 10_000_000_000,
        requestUsed: seed * 3_000_000,
        requestCapacity: seed * 20_000_000
      }
    }
  };
}

async function expectLivePreviewContract(
  preview: Locator,
  expected: {
    title: string;
    typeLabel: string;
    subtitle: string;
    bannerUrls: string[];
    blockTypes: Array<"richText" | "video">;
  }
) {
  await expect(preview).toContainText(expected.title);
  await expect(preview).toContainText(expected.typeLabel);
  await expect(preview).toContainText(expected.subtitle);
  await expect(preview.locator(".detail-preview-banner")).toHaveCount(expected.bannerUrls.length);
  const bannerUrls = await preview.locator(".detail-preview-banner").evaluateAll((items) =>
    items.map((item) => (item as HTMLImageElement).src)
  );
  expect(bannerUrls).toEqual(expected.bannerUrls.map(assetUrl));
  await expect(preview.locator(".detail-preview-card")).toHaveCount(
    expected.blockTypes.length > 0 ? 1 : 0
  );
  await expect(preview.locator(".detail-preview-card > section")).toHaveCount(expected.blockTypes.length);
  const blockTypes = await preview.locator(".detail-preview-card > section").evaluateAll((sections) =>
    sections.map((section) =>
      section.classList.contains("detail-preview-video-wrap") ? "video" : "richText"
    )
  );
  expect(blockTypes).toEqual(expected.blockTypes);
  await expect(preview.locator(".detail-preview-rich-text h1")).toHaveCount(1);
  await expect(preview.locator(".detail-preview-rich-text h1 [data-detail-heading-marker='true']")).toHaveCount(1);
  const geometry = await preview.evaluate((root) => {
    const hero = root.querySelector(".detail-preview-hero")?.getBoundingClientRect();
    const navigation = root.querySelector(".detail-preview-nav--banner-safe")?.getBoundingClientRect();
    const heroCopy = root.querySelector(".detail-preview-hero-copy")?.getBoundingClientRect();
    const back = root.querySelector(".detail-preview-back")?.getBoundingClientRect();
    const content = root.querySelector(".detail-preview-content")?.getBoundingClientRect();
    const firstCard = root.querySelector(".detail-preview-card")?.getBoundingClientRect();
    const heroHeading = root.querySelector(".detail-preview-hero-heading")?.getBoundingClientRect();
    const richHeading = root.querySelector<HTMLElement>(".detail-preview-rich-text h1");
    const marker = richHeading?.querySelector<HTMLElement>("[data-detail-heading-marker='true']");
    const headingContent = richHeading?.querySelector<HTMLElement>("[data-detail-heading-content='true']");
    if (!hero || !navigation || !heroCopy || !back || !content || !firstCard || !heroHeading || !richHeading || !marker || !headingContent) {
      throw new Error("后台详情预览结构缺失");
    }
    const markerRect = marker.getBoundingClientRect();
    const headingContentRect = headingContent.getBoundingClientRect();
    const richHeadingStyle = getComputedStyle(richHeading);
    const rootRect = root.getBoundingClientRect();
    return {
      heroHeight: hero.height,
      navigationTop: navigation.top - rootRect.top,
      navigationHeight: navigation.height,
      bannerBackTopDelta: hero.top - back.top,
      heroCopyTop: heroCopy.top - hero.top,
      headingClearance: heroHeading.top - navigation.bottom,
      heroInsideBanner: heroCopy.bottom <= hero.bottom,
      heroCardClearance: firstCard.top - heroCopy.bottom,
      gutter: Number.parseFloat(getComputedStyle(root.querySelector(".detail-preview-content")!).paddingLeft),
      overlap: hero.bottom - firstCard.top,
      richHeadingFontSize: Number.parseFloat(richHeadingStyle.fontSize),
      richHeadingFontWeight: richHeadingStyle.fontWeight,
      richHeadingDisplay: richHeadingStyle.display,
      richHeadingAlignItems: richHeadingStyle.alignItems,
      markerContentCenterDelta: Math.abs(
        (markerRect.top + markerRect.bottom - headingContentRect.top - headingContentRect.bottom) / 2
      )
    };
  });
  expect(geometry.heroHeight).toBeGreaterThanOrEqual(212);
  expect(geometry.navigationTop).toBe(0);
  expect(geometry.navigationHeight).toBe(64);
  expect(geometry.bannerBackTopDelta).toBeGreaterThanOrEqual(-9);
  expect(geometry.bannerBackTopDelta).toBeLessThanOrEqual(-7);
  expect(geometry.heroCopyTop).toBe(60);
  expect(geometry.headingClearance).toBeGreaterThanOrEqual(7);
  expect(geometry.heroInsideBanner).toBeTruthy();
  expect(geometry.heroCardClearance).toBeGreaterThanOrEqual(11);
  expect(geometry.gutter).toBe(12);
  expect(geometry.overlap).toBeGreaterThanOrEqual(20);
  expect(geometry.overlap).toBeLessThanOrEqual(22);
  expect(geometry.richHeadingFontSize).toBe(17);
  expect(geometry.richHeadingFontWeight).toBe("700");
  expect(geometry.richHeadingDisplay).toBe("flex");
  expect(geometry.richHeadingAlignItems).toBe("center");
  expect(geometry.markerContentCenterDelta).toBeLessThanOrEqual(1);
}

async function createUniqueLibraryUploadPng() {
  const [r, g, b] = randomBytes(3);
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: {
        r,
        g,
        b,
        alpha: 1
      }
    }
  }).png().toBuffer();
}

async function proxyBackupApiThroughPlaywright(page: Page, apiRequest: Parameters<typeof adminToken>[0], importArchive?: Buffer) {
  await page.route("**/api/admin/backups**", async (route) => {
    const browserRequest = route.request();
    const targetUrl = new URL(browserRequest.url());
    const headers = { ...browserRequest.headers() };
    delete headers.origin;
    delete headers.host;
    delete headers["content-length"];
    const response = targetUrl.pathname.endsWith("/import") && browserRequest.method() === "POST" && importArchive
      ? await apiRequest.post(`${apiBase}${targetUrl.pathname}${targetUrl.search}`, {
        headers: { authorization: headers.authorization ?? "" },
        multipart: {
          file: {
            name: "e2e-backup.tar.gz",
            mimeType: "application/gzip",
            buffer: importArchive
          }
        }
      })
      : await apiRequest.fetch(`${apiBase}${targetUrl.pathname}${targetUrl.search}`, {
        method: browserRequest.method(),
        headers,
        data: browserRequest.postDataBuffer() ?? undefined
      });
    const responseHeaders = { ...response.headers() };
    delete responseHeaders["access-control-allow-origin"];
    await route.fulfill({
      status: response.status(),
      headers: responseHeaders,
      body: await response.body()
    });
  });
}

async function deleteDetailPagesByName(request: Parameters<typeof adminApi>[0], name: string) {
  const existing = await adminApi<{ items: DetailPageSummary[] }>(
    request,
    "GET",
    `/api/admin/detail-pages?q=${encodeURIComponent(name)}&pageSize=100`
  );
  for (const detail of existing.items.filter((item) => item.name === name && item.referenceCount === 0)) {
    await adminApi(request, "DELETE", `/api/admin/detail-pages/${detail.id}`);
  }
}

async function findDetailPageByName(request: Parameters<typeof adminApi>[0], name: string) {
  const data = await adminApi<{ items: DetailPageSummary[] }>(
    request,
    "GET",
    `/api/admin/detail-pages?q=${encodeURIComponent(name)}&pageSize=100`
  );
  return data.items.find((item) => item.name === name);
}

async function createRichTextDetailPage(request: Parameters<typeof adminApi>[0], name: string, richTextHtml: string) {
  await deleteDetailPagesByName(request, name);
  return adminApi<{ id: number; name: string; type: string }>(request, "POST", "/api/admin/detail-pages", {
    name,
    type: "rich_text",
    richTextHtml
  });
}

async function selectDetailPageReference(page: Parameters<typeof selectOption>[0], name: string) {
  await page.getByTestId("detail-page-reference-select").click();
  await page.keyboard.type(name);
  const option = visibleSelectOption(page, name);
  await expect(option).toBeVisible();
  await option.click();
}

async function locatorBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("布局目标不可见");
  return box;
}

async function expectNoDocumentHorizontalScroll(page: Page) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollX: window.scrollX
  }));
  expect(geometry.scrollX).toBe(0);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

async function expectTableHorizontalScrollIsScoped(
  page: Page,
  input: { path: string; title: string; tableTestId: string; actionTestId: string }
) {
  await page.goto(input.path);
  await expect(page.getByTestId(input.tableTestId)).toBeVisible();
  await expect(page.locator(".admin-header")).not.toContainText(input.title);
  await expect(page.getByRole("heading", { level: 2, name: input.title })).toHaveCount(1);
  await expectNoDocumentHorizontalScroll(page);

  const sider = page.locator(".admin-layout .ant-layout-sider");
  const header = page.locator(".admin-header");
  const pageHeader = page.locator(".page-header");
  const action = page.getByTestId(input.actionTestId);
  const tableScroll = page.getByTestId(input.tableTestId).locator(".ant-table-content").first();

  const scrollGeometry = await tableScroll.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    scrollLeft: element.scrollLeft
  }));
  expect(scrollGeometry.scrollWidth).toBeGreaterThan(scrollGeometry.clientWidth);

  const before = {
    sider: await locatorBox(sider),
    header: await locatorBox(header),
    pageHeader: await locatorBox(pageHeader),
    action: await locatorBox(action)
  };

  await tableScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  const afterScrollLeft = await tableScroll.evaluate((element) => element.scrollLeft);
  expect(afterScrollLeft).toBeGreaterThan(0);
  await expectNoDocumentHorizontalScroll(page);

  const after = {
    sider: await locatorBox(sider),
    header: await locatorBox(header),
    pageHeader: await locatorBox(pageHeader),
    action: await locatorBox(action)
  };

  for (const key of Object.keys(before) as Array<keyof typeof before>) {
    expect(Math.abs(after[key].x - before[key].x)).toBeLessThanOrEqual(1);
  }
}

test("登录页展示", async ({ page }) => {
  await page.goto(adminPath("/login"));
  await expect(page.getByText("后台管理系统")).toBeVisible();
  await expect(page.getByTestId("login-username")).toBeVisible();
  await expect(page.getByTestId("login-password")).toBeVisible();
});

test("未登录访问后台跳转登录", async ({ page }) => {
  await page.goto(adminPath("/dashboard"));
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("登录成功进入看板并展示 PV", async ({ page }) => {
  await loginAdminUi(page);
  await expect(page.getByTestId("dashboard-pv-today")).toContainText(/今日浏览量.*\d+/s);
  await expect(page.getByTestId("dashboard-pv-week")).toContainText(/本周浏览量.*\d+/s);
  await expect(page.getByTestId("dashboard-pv-month")).toContainText(/本月浏览量.*\d+/s);
});

test("三级用户激活、菜单裁剪、直达拒绝和恢复链接均走真实链路", async ({ page, request }) => {
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const username = `e2e-rbac-user-${runId}`;
  const password = `E2e-Activated-${runId}-Aa1!`;
  const rootPassword = process.env.E2E_ADMIN_PASSWORD;
  expect(rootPassword).toBeTruthy();
  const rootToken = await adminToken(request);
  const createResponse = await request.post(`${apiBase}/api/admin/users`, {
    headers: { authorization: `Bearer ${rootToken}` },
    data: {
      username,
      role: "USER",
      permissions: ["media-assets"],
      currentPassword: rootPassword,
      confirmation: true
    }
  });
  const createBody = await createResponse.json();
  expect(createBody.success, JSON.stringify(createBody)).toBe(true);
  const publicId = String(createBody.data.user.publicId);
  const activationUrl = new URL(String(createBody.data.activationLink));

  await page.goto(`${adminPath("/reset-password")}${activationUrl.hash}`);
  await expect(page).not.toHaveURL(/token=/);
  await page.getByTestId("reset-new-password").fill(password);
  await page.getByTestId("reset-confirm-password").fill(password);
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByText("密码已设置")).toBeVisible();

  await page.goto(adminPath("/login"));
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("sidebar-media-assets")).toBeVisible();
  await expect(page.getByTestId("sidebar-backups")).toHaveCount(0);
  await page.goto(adminPath("/backups"));
  await expect(page.getByText("无权访问", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "备份与恢复" })).toHaveCount(0);

  await page.evaluate(() => localStorage.clear());
  await loginAdminUi(page);
  await page.goto(adminPath("/users"));
  await expect(page.getByRole("row", { name: new RegExp(username) })).toBeVisible();
  await page.getByTestId(`admin-user-reset-link-${publicId}`).click();
  const linkDialog = page.getByRole("dialog", { name: "生成恢复链接" });
  await linkDialog.getByTestId("admin-user-link-password").fill(rootPassword!);
  await linkDialog.getByRole("checkbox").check();
  await linkDialog.getByRole("button", { name: "生成一次性链接" }).click();
  const generatedLink = await page.getByTestId("admin-user-reset-link-value").inputValue();
  expect(generatedLink).toContain("#token=");
  const browserState = await page.evaluate(() => ({
    href: location.href,
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage)
  }));
  expect(JSON.stringify(browserState)).not.toContain(new URL(generatedLink).hash.slice(1));
  const resultDialog = page.getByRole("dialog").filter({ hasText: "链接只显示一次" });
  await resultDialog.getByRole("button", { name: /关\s*闭/ }).click();
  await expect(resultDialog).toHaveCount(0);

  await page.getByTestId("admin-user-create-open").click();
  const createDialog = page.locator(".ant-modal-wrap").filter({ hasText: "新增后台账户" }).last();
  await expect(createDialog).toBeVisible();
  for (const item of adminMenuCatalog) {
    await expect(createDialog.getByRole("treeitem", { name: new RegExp(item.label) })).toBeVisible();
  }
  await createDialog.getByRole("button", { name: /取\s*消/ }).click();

  const peerSuperUsername = `e2e-peer-super-${runId}`;
  const peerSuperPassword = `E2e-Peer-Super-${runId}-Aa1!`;
  const createPeerResponse = await request.post(`${apiBase}/api/admin/users`, {
    headers: { authorization: `Bearer ${rootToken}` },
    data: {
      username: peerSuperUsername,
      role: "USER",
      permissions: [],
      currentPassword: rootPassword,
      confirmation: true
    }
  });
  const createPeerBody = await createPeerResponse.json();
  expect(createPeerBody.success, JSON.stringify(createPeerBody)).toBe(true);
  const peerSuperPublicId = String(createPeerBody.data.user.publicId);
  const peerActivationToken = decodeURIComponent(new URL(String(createPeerBody.data.activationLink)).hash.replace(/^#token=/, ""));
  const activatePeerResponse = await request.post(`${apiBase}/api/admin/auth/reset-password`, {
    data: {
      token: peerActivationToken,
      newPassword: peerSuperPassword,
      confirmPassword: peerSuperPassword
    }
  });
  const activatePeerBody = await activatePeerResponse.json();
  expect(activatePeerBody.success, JSON.stringify(activatePeerBody)).toBe(true);
  const promotePeerResponse = await request.patch(`${apiBase}/api/admin/users/${peerSuperPublicId}`, {
    headers: { authorization: `Bearer ${rootToken}` },
    data: {
      role: "SUPER_ADMIN",
      status: "enabled",
      currentPassword: rootPassword,
      confirmation: true
    }
  });
  const promotePeerBody = await promotePeerResponse.json();
  expect(promotePeerBody.success, JSON.stringify(promotePeerBody)).toBe(true);

  await page.getByTestId("admin-users-refresh").click();
  await expect(page.getByRole("row", { name: new RegExp(peerSuperUsername) })).toBeVisible();
  await expect(page.getByTestId(`admin-user-edit-${peerSuperPublicId}`)).toBeVisible();
  await expect(page.getByTestId(`admin-user-reset-link-${peerSuperPublicId}`)).toHaveCount(0);
  await expect(page.getByTestId(`admin-user-permissions-${peerSuperPublicId}`)).toHaveCount(0);
  await page.getByTestId(`admin-user-edit-${peerSuperPublicId}`).click();
  const editDialog = page.locator(".ant-modal-wrap").filter({ hasText: "编辑后台账户" }).last();
  await expect(editDialog).toBeVisible();
  await expect(editDialog).toContainText("超级管理员相关变更需要重新认证");
  await selectOption(page, "admin-user-edit-status", "禁用");
  await editDialog.getByTestId("admin-user-edit-password").fill(rootPassword!);
  await editDialog.getByRole("checkbox").check();
  await editDialog.getByRole("button", { name: /保\s*存/ }).click();
  await waitForToast(page, "后台账户已更新");

  const disabledPeer = await adminApi<{ items: AdminUserDto[]; total: number }>(
    request,
    "GET",
    "/api/admin/users"
  );
  expect(disabledPeer.items.find((item) => item.publicId === peerSuperPublicId)).toMatchObject({
    role: "SUPER_ADMIN",
    status: "disabled"
  });
});

test("统一通知支持主题堆叠、进度补位和跨浏览器失败日志", async ({ page, browser }) => {
  await page.route("**/api/admin/auth/logout", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { code: "E2E_LOGOUT_FAILURE", message: "E2E 退出失败" }
      })
    });
  });

  const loginPersisted = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/admin/notifications" &&
    response.ok()
  );
  await loginAdminUi(page);
  await loginPersisted;
  const successToast = page.getByTestId("notification-toast").filter({ hasText: "登录成功" });
  await expect(successToast).toHaveAttribute("data-level", "success");

  await page.waitForTimeout(1_200);
  const failurePersisted = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/admin/notifications" &&
    response.ok()
  );
  await page.getByTestId("logout-button").click();
  await failurePersisted;
  const failureToast = page.getByTestId("notification-toast").filter({ hasText: "E2E 退出失败" });
  await expect(failureToast).toHaveAttribute("data-level", "error");
  await expect(page.getByTestId("notification-toast")).toHaveCount(2);
  await expect(failureToast).toHaveClass(/is-visible/);
  await page.waitForTimeout(250);

  const cards = page.getByTestId("notification-toast");
  const firstBox = await cards.nth(0).boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(secondBox!.y - firstBox!.y - firstBox!.height).toBeGreaterThanOrEqual(8);

  const progress = failureToast.locator(".notification-toast__progress");
  const progressBefore = await progress.boundingBox();
  await page.waitForTimeout(500);
  const progressAfter = await progress.boundingBox();
  expect(progressBefore).not.toBeNull();
  expect(progressAfter).not.toBeNull();
  expect(progressAfter!.width).toBeLessThan(progressBefore!.width);
  expect(Math.abs(progressAfter!.x + progressAfter!.width - progressBefore!.x - progressBefore!.width)).toBeLessThanOrEqual(2);

  const successBox = await successToast.boundingBox();
  const closeButton = successToast.getByRole("button", { name: "关闭成功提示" });
  const closeBox = await closeButton.boundingBox();
  expect(successBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(Math.abs(closeBox!.width - closeBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(closeBox!.x + closeBox!.width / 2 - successBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(closeBox!.y + closeBox!.height / 2 - successBox!.y)).toBeLessThanOrEqual(1);
  expect(closeBox!.x).toBeGreaterThanOrEqual(0);
  expect(closeBox!.y).toBeGreaterThanOrEqual(0);

  await page.setViewportSize({ width: 375, height: 812 });
  const narrowCloseBox = await closeButton.boundingBox();
  expect(narrowCloseBox).not.toBeNull();
  expect(narrowCloseBox!.x).toBeGreaterThanOrEqual(0);
  expect(narrowCloseBox!.x + narrowCloseBox!.width).toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1280, height: 720 });

  const failureTopBefore = (await failureToast.boundingBox())!.y;
  await closeButton.click();
  await expect(successToast).toHaveClass(/is-exiting/);
  await expect(successToast).toBeHidden({ timeout: 1_000 });
  await expect(failureToast).toBeVisible();
  await page.waitForTimeout(250);
  const failureTopAfter = (await failureToast.boundingBox())!.y;
  expect(failureTopAfter).toBeLessThan(failureTopBefore);

  await page.getByRole("button", { name: "查看最近 7 天失败日志" }).click();
  const historyDrawer = page.getByRole("dialog", { name: "最近 7 天失败日志" });
  await expect(historyDrawer).not.toContainText("登录成功");
  await expect(historyDrawer).toContainText("E2E 退出失败");
  const failureLogRow = historyDrawer.getByRole("article", { name: /错误原因 E2E 退出失败/ });
  await failureLogRow.hover();
  await expect(page.getByRole("tooltip")).toContainText("E2E 退出失败");
  await historyDrawer.getByRole("button", { name: /close|关闭/i }).click();

  const secondContext = await browser.newContext({ baseURL: "http://127.0.0.1:5173" });
  const secondPage = await secondContext.newPage();
  try {
    await loginAdminUi(secondPage);
    await secondPage.getByRole("button", { name: "查看最近 7 天失败日志" }).click();
    const secondHistory = secondPage.getByRole("dialog", { name: "最近 7 天失败日志" });
    await expect(secondHistory).toContainText("E2E 退出失败");
  } finally {
    await secondContext.close();
  }

  await expect(failureToast).toBeHidden({ timeout: 7_000 });
});

test("EdgeOne 系统配置与刷新全部使用安全的单次聚合流程", async ({ page }) => {
  await loginAdminUi(page);

  let dashboardData: DashboardOverviewResponse = {
    todayUniqueUsers: 1,
    weekDailyUniqueUsers: 2,
    monthDailyUniqueUsers: 3,
    edgeOne: { status: "not_configured" }
  };
  let dashboardRequests = 0;
  let configData: EdgeOneConfigResponse = {
    zoneId: null,
    secretIdMasked: null,
    secretIdConfigured: false,
    secretKeyConfigured: false,
    updatedAt: null
  };
  let submittedConfig: Record<string, unknown> | null = null;

  await page.route("**/api/admin/dashboard/overview", async (route) => {
    dashboardRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: dashboardData, message: "ok" })
    });
  });
  await page.route("**/api/admin/system-config/edgeone", async (route) => {
    if (route.request().method() === "PUT") {
      submittedConfig = route.request().postDataJSON() as Record<string, unknown>;
      configData = {
        zoneId: String(submittedConfig.zoneId),
        secretIdMasked: "AKID****E2E1",
        secretIdConfigured: true,
        secretKeyConfigured: true,
        updatedAt: "2026-07-16T08:00:00.000Z"
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: configData, message: "ok" })
    });
  });

  await page.goto(adminPath("/dashboard"));
  await expect(page.getByText("尚未配置 EdgeOne CAM 凭证与 ZoneId")).toBeVisible();
  await expect(page.getByText("官方计费数据可能延迟约 3 小时")).toBeVisible();
  const topLevelMenuTestIds = await page.locator(".ant-menu-root > li").evaluateAll((items) =>
    items.map((item) => item.querySelector("[data-testid]")?.getAttribute("data-testid"))
  );
  expect(topLevelMenuTestIds).toEqual([
    "sidebar-dashboard",
    "sidebar-group-home",
    "sidebar-group-content",
    "sidebar-group-assets",
    "sidebar-group-account",
    "sidebar-scheduled-tasks",
    "sidebar-system-config"
  ]);
  await page.getByTestId("sidebar-system-config").click();
  await expect(page).toHaveURL(/\/admin\/system-config$/);
  await expect(page.getByRole("heading", { level: 2, name: "系统配置" })).toBeVisible();
  await page.goto(adminPath("/dashboard"));
  await expect(page.getByText("尚未配置 EdgeOne CAM 凭证与 ZoneId")).toBeVisible();
  await page.getByRole("button", { name: /前往系统配置/ }).click();
  await expect(page).toHaveURL(/\/admin\/system-config$/);
  await expect(page.getByRole("heading", { level: 2, name: "系统配置" })).toBeVisible();

  const inputSecretId = ["AKID", Date.now(), "E2E1"].join("");
  const inputSecretKey = ["edgeone", "input", Date.now(), "e2e"].join("-");
  await expect(page.getByTestId("edgeone-secret-id")).toHaveValue("");
  await expect(page.getByTestId("edgeone-secret-key")).toHaveValue("");
  await page.getByTestId("edgeone-zone-id").fill("zone-e2e");
  await page.getByTestId("edgeone-secret-id").fill(inputSecretId);
  await page.getByTestId("edgeone-secret-key").fill(inputSecretKey);
  await page.getByTestId("edgeone-config-save").click();

  await expect.poll(() => submittedConfig).toEqual({
    zoneId: "zone-e2e",
    secretId: inputSecretId,
    secretKey: inputSecretKey
  });
  await expect(page.getByTestId("edgeone-secret-id")).toHaveValue("");
  await expect(page.getByTestId("edgeone-secret-key")).toHaveValue("");
  await expect(page.getByText(/AKID\*\*\*\*E2E1/)).toBeVisible();

  const browserResidue = await page.evaluate(({ secretId, secretKey }) => {
    const storageValues = [localStorage, sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? "")
    );
    return {
      urlContainsCredential: location.href.includes(secretId) || location.href.includes(secretKey),
      htmlContainsCredential: document.documentElement.innerHTML.includes(secretId) || document.documentElement.innerHTML.includes(secretKey),
      storageContainsCredential: storageValues.some((value) => value.includes(secretId) || value.includes(secretKey))
    };
  }, { secretId: inputSecretId, secretKey: inputSecretKey });
  expect(browserResidue).toEqual({
    urlContainsCredential: false,
    htmlContainsCredential: false,
    storageContainsCredential: false
  });

  dashboardData = edgeOneReadyOverview(2);
  if (dashboardData.edgeOne.status !== "ready") throw new Error("E2E fixture must be ready");
  dashboardData.edgeOne.last24Hours.trafficBytes = 750_000_000;
  dashboardData.edgeOne.last24Hours.requestCount = 999;
  dashboardData.edgeOne.package.trafficUsedBytes = 500_000_000;
  dashboardData.edgeOne.package.requestUsed = 999;
  const leaveOnlySecret = ["leave", "only", Date.now()].join("-");
  await page.getByTestId("edgeone-secret-key").fill(leaveOnlySecret);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("sidebar-dashboard").click();
  await expect(page.getByTestId("dashboard-pv-today")).toContainText("2");
  await page.goto(adminPath("/system-config"));
  await expect(page.getByTestId("edgeone-secret-id")).toHaveValue("");
  await expect(page.getByTestId("edgeone-secret-key")).toHaveValue("");
  expect(await page.evaluate((secret) => {
    const storageValues = [localStorage, sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? "")
    );
    return location.href.includes(secret) || document.documentElement.innerHTML.includes(secret) ||
      storageValues.some((value) => value.includes(secret));
  }, leaveOnlySecret)).toBe(false);
  await page.goto(adminPath("/dashboard"));
  await expect(page.getByTestId("dashboard-edgeone-last24-traffic")).toContainText("750.00 MB");
  await expect(page.getByTestId("dashboard-edgeone-last24-requests")).toContainText("999 次");
  await expect(page.getByTestId("dashboard-edgeone-package-traffic")).toContainText("500.00 MB / 20.00 GB");
  await expect(page.getByTestId("dashboard-edgeone-package-requests")).toContainText("999 次 / 40.00 M");
  await expect(page.getByLabel("EdgeOne 配置信息")).toContainText("Zone zone-e2e");
  await expect(page.getByLabel("EdgeOne 配置信息")).toContainText("套餐 plan-e2e");
  await expect(page.getByText("最近成功刷新：", { exact: false })).toBeVisible();

  const refresh = page.getByTestId("dashboard-refresh-all");
  await expect(refresh).toHaveAccessibleName("刷新全部");
  expect(await refresh.evaluate((element) => ({ tag: element.tagName, tabIndex: (element as HTMLElement).tabIndex }))).toEqual({
    tag: "BUTTON",
    tabIndex: 0
  });
  const requestsBeforeRefresh = dashboardRequests;
  dashboardData = edgeOneReadyOverview(5);
  if (dashboardData.edgeOne.status !== "ready") throw new Error("E2E fixture must be ready");
  dashboardData.edgeOne.last24Hours.requestCount = 125_000;
  await refresh.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("dashboard-pv-today")).toContainText("5");
  await expect(page.getByTestId("dashboard-pv-week")).toContainText("6");
  await expect(page.getByTestId("dashboard-pv-month")).toContainText("7");
  await expect(page.getByTestId("dashboard-edgeone-last24-traffic")).toContainText("5.00 GB");
  await expect(page.getByTestId("dashboard-edgeone-last24-requests")).toContainText("125.00 K");
  await expect(page.getByTestId("dashboard-edgeone-package-requests")).toContainText("15.00 M / 100.00 M");
  expect(dashboardRequests).toBe(requestsBeforeRefresh + 1);

  for (const [width, columns] of [[1440, 4], [1024, 2], [768, 2], [375, 1]] as const) {
    await page.setViewportSize({ width, height: 900 });
    const renderedColumns = await page.locator(".dashboard-metric-grid--edgeone").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length
    );
    expect(renderedColumns).toBe(columns);
    await expectNoDocumentHorizontalScroll(page);
    if (process.env.EDGEONE_VISUAL_OUTPUT_DIR) {
      await page.screenshot({
        path: path.join(process.env.EDGEONE_VISUAL_OUTPUT_DIR, `edgeone-ready-${width}.png`),
        fullPage: true
      });
    }
  }

  dashboardData = edgeOneReadyOverview(5);
  await page.goto(adminPath("/dashboard"));
  await expect(page.getByTestId("dashboard-edgeone-last24-requests")).toContainText("5.00 M");
});

test("定时任务展示规划并确认后只立即执行一次", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdminUi(page);

  let listCount = 0;
  let runCount = 0;
  const baseTasks: ScheduledTaskDto[] = [
    {
      taskKey: "admin-session-cleanup",
      name: "管理员会话清理",
      description: "删除已过期的后台管理员登录会话。",
      cron: "2 * * * *",
      timezone: "Asia/Shanghai",
      nextExecutionAt: "2026-07-18T01:02:00.000Z",
      lastExecutionAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      isRunning: false,
      resultSummary: null
    },
    {
      taskKey: "admin-notification-cleanup",
      name: "管理员消息清理",
      description: "删除超过保留期的后台通知消息。",
      cron: "10 3 * * *",
      timezone: "Asia/Shanghai",
      nextExecutionAt: "2026-07-18T19:10:00.000Z",
      lastExecutionAt: "2026-07-17T19:10:00.000Z",
      lastFinishedAt: "2026-07-17T19:10:01.000Z",
      lastStatus: "success",
      isRunning: false,
      resultSummary: { deletedCount: 3 }
    },
    {
      taskKey: "analytics-cleanup",
      name: "访问统计清理",
      description: "删除超过保留期的访问统计数据。",
      cron: "20 3 * * *",
      timezone: "Asia/Shanghai",
      nextExecutionAt: "2026-07-18T19:20:00.000Z",
      lastExecutionAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      isRunning: false,
      resultSummary: null
    },
    {
      taskKey: "edgeone-prefetch-reconcile",
      name: "EdgeOne 预热对账",
      description: "对账 EdgeOne 资源预热任务状态并推进重试。",
      cron: "*/5 * * * *",
      timezone: "Asia/Shanghai",
      nextExecutionAt: "2026-07-18T01:05:00.000Z",
      lastExecutionAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      isRunning: false,
      resultSummary: null
    }
  ];

  await page.route("**/api/admin/scheduled-tasks**", async (route) => {
    if (route.request().method() === "POST") {
      runCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            taskKey: "admin-session-cleanup",
            status: "success",
            startedAt: "2026-07-18T01:00:00.000Z",
            finishedAt: "2026-07-18T01:00:01.000Z",
            resultSummary: { deletedCount: 1 }
          },
          message: "ok"
        })
      });
      return;
    }
    listCount += 1;
    const items = baseTasks.map((task) => task.taskKey === "admin-session-cleanup" && runCount > 0
      ? {
          ...task,
          lastExecutionAt: "2026-07-18T01:00:00.000Z",
          lastFinishedAt: "2026-07-18T01:00:01.000Z",
          lastStatus: "success" as const,
          resultSummary: { deletedCount: 1 }
        }
      : task);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { items }, message: "ok" })
    });
  });

  await page.getByTestId("sidebar-scheduled-tasks").click();
  await expect(page).toHaveURL(/\/admin\/scheduled-tasks$/);
  await expect(page.getByRole("heading", { level: 2, name: "定时任务" })).toBeVisible();
  await expect(page.getByText("管理员会话清理")).toBeVisible();
  await expect(page.getByText("删除已过期的后台管理员登录会话。")).toBeVisible();
  await expect(page.getByText("2 * * * *")).toBeVisible();
  await expect(page.getByText("2026-07-18 09:02:00")).toBeVisible();
  await expect(page.getByText("从未执行").first()).toBeVisible();
  await expect(page.getByText("2026-07-18 03:10:00")).toBeVisible();
  await expect(page.getByRole("row", { name: /自动备份/ })).toHaveCount(0);

  const runButton = page.getByTestId("scheduled-task-run-admin-session-cleanup");
  await runButton.click();
  const dialog = page.getByRole("dialog", { name: "立即执行“管理员会话清理”？" });
  await expect(dialog).toContainText("使用服务器现有配置");
  const confirmButton = dialog.getByRole("button", { name: /立\s*即\s*执\s*行/ });
  await confirmButton.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(runButton).toBeDisabled();
  await expect.poll(() => runCount).toBe(1);
  await expect.poll(() => listCount).toBe(2);
  await expect(page.getByText("成功", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2026-07-18 09:00:00")).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoDocumentHorizontalScroll(page);
  const tableGeometry = await page.locator(".scheduled-tasks-card .ant-table-content").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(tableGeometry.scrollWidth).toBeGreaterThan(tableGeometry.clientWidth);
});

test("修改密码后撤销旧 token 并要求重新登录", async ({ page, request }) => {
  const username = process.env.E2E_ADMIN_USERNAME;
  const previousPassword = process.env.E2E_ADMIN_PASSWORD;
  if (!username || !previousPassword) throw new Error("E2E admin credentials are missing");

  await loginAdminUi(page);
  const oldToken = await page.evaluate(() => localStorage.getItem("eventarts.admin.token"));
  if (!oldToken) throw new Error("old admin token was not stored");

  await page.getByTestId("sidebar-change-password").click();
  await expect(page.getByRole("heading", { level: 2, name: "修改密码" })).toBeVisible();

  const nextPassword = `E2eNext-${Date.now()}-Aa1!`;
  await page.getByTestId("change-current-password").fill(previousPassword);
  await page.getByTestId("change-new-password").fill(nextPassword);
  await page.getByTestId("change-confirm-password").fill(nextPassword);
  await page.getByTestId("change-password-submit").click();
  await waitForToast(page, "密码已修改，请重新登录");
  await expect(page).toHaveURL(/\/admin\/login$/);

  process.env.E2E_ADMIN_PASSWORD = nextPassword;

  const oldTokenResponse = await request.get(`${apiBase}/api/admin/auth/me`, {
    headers: { authorization: `Bearer ${oldToken}` }
  });
  expect(oldTokenResponse.status()).toBe(401);
  await expect(oldTokenResponse.json()).resolves.toMatchObject({
    success: false,
    error: { code: "UNAUTHORIZED" }
  });

  const oldPasswordResponse = await request.post(`${apiBase}/api/admin/auth/login`, {
    data: { username, password: previousPassword }
  });
  expect(oldPasswordResponse.status()).toBe(401);

  const restoreToken = await adminToken(request);
  const restorePasswordResponse = await request.post(`${apiBase}/api/admin/auth/change-password`, {
    headers: { authorization: `Bearer ${restoreToken}` },
    data: {
      currentPassword: nextPassword,
      newPassword: previousPassword,
      confirmPassword: previousPassword
    }
  });
  expect(restorePasswordResponse.ok()).toBeTruthy();
  process.env.E2E_ADMIN_PASSWORD = previousPassword;

  await loginAdminUi(page);
  await expect(page.getByTestId("dashboard-pv-today")).toBeVisible();
});

test("首页配置可保存", async ({ page }) => {
  await loginAdminUi(page);
  await page.getByTestId("sidebar-site-config").click();
  await page.getByTestId("site-app-name").fill("喜缘主持・演艺服务 E2E");
  await page.getByTestId("site-subtitle").fill("专业主持人・歌手・演艺团队 E2E");
  await page.getByTestId("site-save").click();
  await waitForToast(page, "保存成功");
});

test("新增公告并修改状态", async ({ page }) => {
  await loginAdminUi(page);
  await page.getByTestId("sidebar-announcements").click();
  await page.getByTestId("announcements-create").click();
  await page.getByTestId("announcement-summary").fill("E2E 公告");
  await page.getByTestId("announcement-content").fill("这是一条后台自动化新增公告");
  await fillNumber(page, "announcement-display-duration", 1200);
  await fillNumber(page, "sort-order", 88);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("announcements-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByRole("row", { name: /E2E 公告/ })).toBeVisible();

  await page.getByRole("row", { name: /E2E 公告/ }).getByTestId("announcements-edit").click();
  await selectOption(page, "status-select", "停用");
  await page.getByTestId("announcements-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByRole("row", { name: /E2E 公告/ })).toContainText("停用");
});

test("新增公告保存并继续会清空表单并连续创建", async ({ page, request }) => {
  const summaries = ["E2E 连续公告 A", "E2E 连续公告 B"];
  async function removeFixtures() {
    const data = await adminApi<{ items: Array<{ id: number; summary: string }> }>(
      request,
      "GET",
      "/api/admin/announcements"
    );
    for (const item of data.items.filter((record) => summaries.includes(record.summary))) {
      await adminApi(request, "DELETE", `/api/admin/announcements/${item.id}`);
    }
  }

  await removeFixtures();
  try {
    await loginAdminUi(page);
    await page.getByTestId("sidebar-announcements").click();
    await page.getByTestId("announcements-create").click();
    await page.getByTestId("announcement-summary").fill(summaries[0]);
    await page.getByTestId("announcement-content").fill("第一条连续创建内容");
    await fillNumber(page, "announcement-display-duration", 5);
    await fillNumber(page, "sort-order", 91);
    await page.getByTestId("announcements-save-continue").click();
    await waitForToast(page, "保存成功");

    const drawer = page.getByTestId("announcements-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("新增公告管理");
    await expect(page.getByTestId("announcement-summary")).toHaveValue("");
    await expect(page.getByTestId("announcement-content")).toHaveValue("");
    await expect(page.getByTestId("announcement-display-duration")).toHaveValue("3.0");
    await expect(page.getByTestId("sort-order")).toHaveValue("92");
    await expect(page.getByTestId("status-select")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("announcement-summary").fill(summaries[1]);
    await page.getByTestId("announcement-content").fill("第二条连续创建内容");
    await page.getByTestId("announcements-save").click();
    await waitForToast(page, "保存成功");

    const saved = await adminApi<{ items: Array<{ id: number; summary: string; content: string; sortOrder: number }> }>(
      request,
      "GET",
      "/api/admin/announcements"
    );
    const created = saved.items.filter((item) => summaries.includes(item.summary));
    expect(created).toHaveLength(2);
    expect(new Set(created.map((item) => item.id)).size).toBe(2);
    expect(created.find((item) => item.summary === summaries[0])?.content).toBe("第一条连续创建内容");
    expect(created.find((item) => item.summary === summaries[1])?.content).toBe("第二条连续创建内容");
    expect(created.find((item) => item.summary === summaries[1])?.sortOrder).toBe(92);
  } finally {
    await removeFixtures();
  }
});

test("新增 Banner", async ({ page, request }) => {
  const existing = await adminApi<{ items: Array<{ id: number; title: string }> }>(request, "GET", "/api/admin/banners");
  for (const banner of existing.items.filter((item) => item.title === "E2E Banner")) {
    await adminApi(request, "DELETE", `/api/admin/banners/${banner.id}`);
  }
  await loginAdminUi(page);
  await page.getByTestId("sidebar-banners").click();
  await page.getByTestId("banners-create").click();
  await page.getByTestId("banner-title").fill("E2E Banner");
  await chooseMediaFromLibrary(page, "banner-image-select", /banner-default\.png/);
  await expect(page.getByTestId("banner-image-select-preview").locator("img")).toHaveCSS("object-fit", "contain");
  await page.getByTestId("banner-image-select-preview").hover();
  await expect(page.getByText("banner-default.png").last()).toBeVisible();
  await expect(page.getByTestId("detail-page-reference-select")).toBeVisible();
  await fillNumber(page, "banner-switch-duration", 1500);
  await fillNumber(page, "sort-order", 77);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("banners-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByRole("row", { name: /E2E Banner/ })).toBeVisible();
});

test("新增菜单项并验证五种规范类型、首页显示和动态配置", async ({ page, request }) => {
  const existing = await adminApi<{ items: Array<{ id: number; text: string }> }>(request, "GET", "/api/admin/menu-items");
  for (const menu of existing.items.filter((item) => item.text === "E2E 联系我们")) {
    await adminApi(request, "DELETE", `/api/admin/menu-items/${menu.id}`);
  }
  await loginAdminUi(page);
  await page.getByTestId("sidebar-menu-items").click();
  await expect(page.getByText("分类菜单").first()).toBeVisible();
  const seededRow = page.getByRole("row", { name: /人员/ }).first();
  await seededRow.getByTestId("menu-items-edit").click();
  await expect(page.getByTestId("menu-text")).toHaveValue("人员");
  await page.getByTestId("menu-items-save").click();
  await waitForToast(page, "保存成功");

  await page.getByTestId("menu-items-create").click();
  await page.getByTestId("menu-text").fill("E2E 联系我们");
  await chooseMediaFromLibrary(page, "menu-icon-select", /icon-contact\.png/);
  await expect(page.getByTestId("menu-show-on-home")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("menu-type-select").click();
  for (const label of ["人员", "活动案例", "文章", "详情页直达", "联系我们"]) {
    await expect(visibleSelectOption(page, label)).toBeVisible();
  }
  for (const removedLabel of ["主持人", "歌手", "演员"]) {
    await expect(visibleSelectOption(page, removedLabel)).toHaveCount(0);
  }
  await visibleSelectOption(page, "人员").click();
  await expect(page.getByTestId("menu-config-artist-category")).toBeVisible();
  await expect(page.getByTestId("menu-config-default-sort")).toBeVisible();
  await expect(page.getByTestId("menu-config-page-size")).toBeVisible();

  await selectOption(page, "menu-type-select", "活动案例");
  await expect(page.getByTestId("menu-config-category")).toBeVisible();
  await expect(page.getByTestId("menu-config-only-featured")).toBeVisible();

  await selectOption(page, "menu-type-select", "联系我们");
  await expect(page.getByTestId("menu-config-phone")).toBeVisible();
  await page.getByTestId("menu-config-phone").fill("13800001111");
  await fillNumber(page, "sort-order", 99);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("menu-show-on-home").click();
  await expect(page.getByTestId("menu-show-on-home")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("menu-items-save").click();
  await waitForToast(page, "保存成功");
  const row = page.getByRole("row", { name: /E2E 联系我们/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("隐藏");

  const savedList = await adminApi<{ items: Array<{ id: number; text: string; showOnHome: boolean }> }>(request, "GET", "/api/admin/menu-items");
  const saved = savedList.items.find((item) => item.text === "E2E 联系我们");
  expect(saved?.showOnHome).toBe(false);

  await row.getByTestId("menu-items-edit").click();
  await expect(page.getByTestId("menu-show-on-home")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("menu-show-on-home").click();
  await page.getByTestId("menu-items-save").click();
  await waitForToast(page, "保存成功");
  const updated = await adminApi<{ showOnHome: boolean }>(request, "GET", `/api/admin/menu-items/${saved?.id}`);
  expect(updated.showOnHome).toBe(true);
});

test("详情页直达菜单按类型选择详情页、正确回填并参与删除保护", async ({ page, request }) => {
  const menuText = "E2E 详情页直达";
  const richName = "E2E 菜单单富文本详情";
  const removeFixtures = async () => {
    const menus = await adminApi<{ items: Array<{ id: number; text: string }> }>(request, "GET", "/api/admin/menu-items");
    for (const menu of menus.items.filter((item) => item.text === menuText)) {
      await adminApi(request, "DELETE", `/api/admin/menu-items/${menu.id}`);
    }
    await deleteDetailPagesByName(request, richName);
  };

  await removeFixtures();
  try {
    const richDetail = await createRichTextDetailPage(request, richName, "<p>E2E 菜单直达正文</p>");
    const details = await adminApi<{ items: DetailPageSummary[] }>(
      request,
      "GET",
      "/api/admin/detail-pages?type=banner_rich_text&pageSize=100"
    );
    const bannerDetail = details.items.find((item) => item.type === "banner_rich_text");
    if (!bannerDetail) throw new Error("BANNER + 富文本 seed 详情缺失");

    await loginAdminUi(page);
    await page.getByTestId("sidebar-menu-items").click();
    await page.getByTestId("menu-items-create").click();
    await page.getByTestId("menu-text").fill(menuText);
    await chooseMediaFromLibrary(page, "menu-icon-select", /icon-contact\.png/);
    await selectOption(page, "menu-type-select", "详情页直达");
    await expect(page.getByTestId("detail-page-reference-select")).toHaveClass(/ant-select-disabled/);

    await selectOption(page, "menu-config-detail-page-type", "单富文本");
    await page.getByTestId("detail-page-reference-select").click();
    await expect(visibleSelectOption(page, richName)).toBeVisible();
    await expect(visibleSelectOption(page, bannerDetail.name)).toHaveCount(0);
    await visibleSelectOption(page, richName).click();
    await page.getByTestId("menu-items-save").click();
    await waitForToast(page, "保存成功");

    const menus = await adminApi<{
      items: Array<{
        id: number;
        text: string;
        type: string;
        configJson: { detailPageType?: string; detailPageId?: number };
      }>;
    }>(request, "GET", "/api/admin/menu-items");
    const saved = menus.items.find((item) => item.text === menuText);
    expect(saved).toMatchObject({
      type: "detail_page",
      configJson: { detailPageType: "rich_text", detailPageId: richDetail.id }
    });
    if (!saved) throw new Error("详情页直达菜单保存失败");

    const row = page.getByRole("row", { name: new RegExp(menuText) });
    await row.getByTestId("menu-items-edit").click();
    await expect(page.getByTestId("menu-config-detail-page-type")).toContainText("单富文本");
    await expect(page.getByTestId("detail-page-reference-select")).toContainText(richName);

    const token = await adminToken(request);
    const blocked = await request.delete(`${apiBase}/api/admin/detail-pages/${richDetail.id}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe("DETAIL_PAGE_IN_USE");

    await adminApi(request, "DELETE", `/api/admin/menu-items/${saved.id}`);
    await adminApi(request, "DELETE", `/api/admin/detail-pages/${richDetail.id}`);
  } finally {
    await removeFixtures();
  }
});

test("人员管理保留列表字段并只选择详情页引用", async ({ page }) => {
  await loginAdminUi(page);
  await page.getByTestId("sidebar-artists").click();
  await page.getByTestId("artists-create").click();

  await expect(page.getByTestId("artist-name")).toBeVisible();
  await expect(page.getByTestId("artist-type")).toBeVisible();
  await expect(page.getByTestId("artist-cover-select")).toBeVisible();
  await expect(page.getByTestId("artist-location")).toBeVisible();
  await expect(page.getByTestId("artist-badge")).toBeVisible();
  await expect(page.getByTestId("artist-tags")).toBeVisible();
  await expect(page.getByTestId("artist-summary")).toBeVisible();
  await expect(page.getByTestId("artist-detail")).toHaveCount(0);
  await expect(page.getByTestId("detail-page-reference-select")).toBeVisible();
  await expect(page.getByTestId("detail-page-empty-hint")).toHaveCount(0);
  await expect(page.getByTestId("detail-page-type")).toHaveCount(0);
  await expect(page.getByTestId("detail-rich-text-editor")).toHaveCount(0);
  await page.getByTestId("artists-save").click();
  await expect(page.getByText("请至少填写一个标签")).toHaveCount(0);
  await expect(page.getByText("请输入演职人员描述")).toHaveCount(0);
});

test("详情页管理预览可创建 BANNER 富文本并被人员引用", async ({ page, request }) => {
  const existingArtists = await adminApi<{ items: Array<{ id: number; name: string }> }>(request, "GET", "/api/admin/artists?pageSize=100");
  for (const artist of existingArtists.items.filter((item) => item.name === "E2E 共享详情演员")) {
    await adminApi(request, "DELETE", `/api/admin/artists/${artist.id}`);
  }
  await deleteDetailPagesByName(request, "E2E 共享详情演员页");
  await loginAdminUi(page);

  await page.getByTestId("sidebar-detail-pages").click();
  await page.getByTestId("detail-page-create").click();
  await page.getByTestId("detail-page-name").fill("E2E 共享详情演员页");
  await selectOption(page, "detail-page-type", "BANNER + 富文本");
  await page.getByTestId("detail-hero-title").fill("E2E 共享详情演员");
  await page.getByTestId("detail-hero-type-label").fill("演员");
  await page.getByTestId("detail-hero-subtitle").fill("E2E 专业舞台表达");
  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-balanced.png");
  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-close.png");
  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-wide.png");

  const media = await adminApi<{ items: MediaAssetSummary[] }>(request, "GET", "/api/admin/media-assets?pageSize=100");
  const balanced = media.items.find((asset) => asset.resourceName === "banner-linran-balanced.png");
  const close = media.items.find((asset) => asset.resourceName === "banner-linran-close.png");
  const wide = media.items.find((asset) => asset.resourceName === "banner-linran-wide.png");
  const richImage = media.items.find((asset) => asset.resourceName === "advantage-experience.png");
  const richVideo = media.items.find((asset) => asset.resourceName === "detail-case-demo.mp4");
  expect(balanced && close && wide && richImage && richVideo).toBeTruthy();
  if (!balanced || !close || !wide || !richImage || !richVideo) throw new Error("详情页种子资源缺失");
  await page.getByRole("button", { name: "将 banner-linran-wide.png 上移" }).click();
  await expect(page.getByTestId(`detail-banner-order-${wide.id}`)).toHaveText("第 2 张");
  await expect(page.getByTestId(`detail-banner-order-${close.id}`)).toHaveText("第 3 张");
  await expect(page.getByTestId(`detail-banner-item-${balanced.id}`).locator("img")).toHaveCSS("object-fit", "contain");

  const editor = page.getByRole("textbox", { name: "详情页富文本内容" });
  await editor.fill("E2E 人员详情标题");
  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.getByLabel("段落与标题").selectOption("h1");
  const editorHeading = editor.locator("h1");
  await expect(editorHeading).toContainText("E2E 人员详情标题");
  await editorHeading.click();
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("E2E 人员详情正文");
  await chooseDetailMediaFromLibrary(page, page.getByRole("button", { name: "插入图片" }), "advantage-experience.png");
  await chooseDetailMediaFromLibrary(page, page.getByRole("button", { name: "插入视频" }), "detail-case-demo.mp4");
  await expect(editor.locator("img[data-media-asset-id]")).toHaveCount(1);
  await expect(editor.locator("video[data-media-asset-id]")).toHaveCount(1);

  const livePreview = page.getByTestId("detail-designer-live-preview");
  await expectLivePreviewContract(livePreview, {
    title: "E2E 共享详情演员",
    typeLabel: "演员",
    subtitle: "E2E 专业舞台表达",
    bannerUrls: [balanced.url, wide.url, close.url],
    blockTypes: ["richText", "video"]
  });
  await expect(livePreview.locator(".detail-preview-banner.is-current")).toHaveCSS("object-fit", "cover");
  await expect(livePreview.locator("video")).toHaveCount(1);
  const previewMediaGeometry = await livePreview.evaluate((root) => {
    const image = root.querySelector(".detail-preview-rich-text img") as HTMLImageElement | null;
    const videoWrap = root.querySelector(".detail-preview-video-wrap") as HTMLElement | null;
    const video = videoWrap?.querySelector("video") as HTMLVideoElement | null;
    if (!image || !videoWrap || !video) throw new Error("后台详情预览媒体结构缺失");
    return {
      imageWidth: image.getBoundingClientRect().width,
      imageInlineWidth: image.style.width,
      imageInlineMaxWidth: image.style.maxWidth,
      videoWrapWidth: videoWrap.getBoundingClientRect().width,
      videoWrapMaxWidth: videoWrap.style.maxWidth,
      videoAspectRatio: video.style.aspectRatio,
      videoWidth: video.getBoundingClientRect().width
    };
  });
  if (!richImage.width || !richImage.height || !richVideo.width || !richVideo.height) {
    throw new Error("详情页富文本种子媒体缺少尺寸");
  }
  expect(previewMediaGeometry.imageInlineWidth).toBe(`${richImage.width}px`);
  expect(previewMediaGeometry.imageInlineMaxWidth).toBe("100%");
  expect(previewMediaGeometry.imageWidth).toBeLessThanOrEqual(richImage.width + 1);
  expect(previewMediaGeometry.videoWrapMaxWidth).toBe(`${richVideo.width}px`);
  expect(previewMediaGeometry.videoAspectRatio).toBe(`${richVideo.width} / ${richVideo.height}`);
  expect(previewMediaGeometry.videoWidth).toBeLessThanOrEqual(richVideo.width + 1);

  await page.getByTestId("detail-designer-save").click();
  await waitForToast(page, "保存成功");

  const detail = await findDetailPageByName(request, "E2E 共享详情演员页");
  expect(detail?.type).toBe("banner_rich_text");
  if (!detail) throw new Error("新建详情页未出现在后台列表接口");

  const savedDetail = await adminApi<{ banners: Array<{ assetId: number }>; richTextHtml: string }>(request, "GET", `/api/admin/detail-pages/${detail.id}`);
  expect(savedDetail.banners.map((banner) => banner.assetId)).toEqual([balanced.id, wide.id, close.id]);
  expect(savedDetail.richTextHtml).toContain("data-media-asset-id");

  await page.getByTestId("sidebar-artists").click();
  await page.getByTestId("artists-create").click();
  await page.getByTestId("artist-name").fill("E2E 共享详情演员");
  await selectOption(page, "artist-type", "演员");
  await chooseMediaFromLibrary(page, "artist-cover-select", /artist-cover-01\.png/);
  await page.getByTestId("artist-location").fill("杭州 E2E");
  await page.getByTestId("artist-badge").fill("测试主持");
  const tagsInput = page.getByTestId("artist-tags").locator("input");
  for (const [index, tag] of ["标签一", "标签二", "标签三"].entries()) {
    await tagsInput.fill(tag);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content", { hasText: tag }).click();
    await expect(page.getByTestId("artist-tags").locator(".ant-select-selection-item")).toHaveCount(index + 1);
  }
  await page.getByTestId("artist-summary").fill("后台自动化验证列表封面、地点、左上标签和四个下方标签。");
  await fillNumber(page, "sort-order", 0);
  await selectOption(page, "status-select", "启用");
  await selectDetailPageReference(page, "E2E 共享详情演员页");
  await page.getByTestId("artists-save").click();
  await waitForToast(page, "保存成功");

  const record = await adminApi<{ items: Array<{ id: number; name: string; location: string; badge: string; tags: string[]; tagsJson: string[]; detailPageId: number | null; detailPageType: string | null; detailPageSummary: { id: number; name: string; type: string } | null }> }>(request, "GET", "/api/admin/artists?pageSize=100");
  const created = record.items.find((item) => item.name === "E2E 共享详情演员");
  expect(created).toMatchObject({ location: "杭州 E2E", badge: "测试主持", tags: ["标签一", "标签二", "标签三"], detailPageId: detail.id });
  expect(created?.tagsJson).toEqual(["标签一", "标签二", "标签三"]);
  expect(created?.detailPageType).toBe("banner_rich_text");
  expect(created?.detailPageSummary).toMatchObject({ id: detail.id, name: "E2E 共享详情演员页", type: "banner_rich_text" });
  if (!created) throw new Error("新建人员未出现在后台列表接口");

  const row = page.getByTestId(`artists-row-${created.id}`);
  await expect(row).toContainText("杭州 E2E");
  await expect(row).toContainText("测试主持");
  await expect(row).toContainText("BANNER + 富文本");
  await expect(row.locator("img.artist-cover-thumb")).toHaveCSS("object-fit", "contain");
  await row.getByTestId("artists-edit").click();
  await expect(page.getByTestId("artist-tags").locator(".ant-select-selection-item")).toHaveCount(3);
  await expect(page.getByTestId("detail-page-reference-select")).toContainText("E2E 共享详情演员页");
  await page.getByTestId("artists-save").click();
  await waitForToast(page, "保存成功");

  const referenceCount = await findDetailPageByName(request, "E2E 共享详情演员页");
  expect(referenceCount?.referenceCount).toBeGreaterThanOrEqual(1);
});

test("案例表单可引用单富文本详情页并保留业务字段", async ({ page, request }) => {
  const existingCases = await adminApi<{ items: Array<{ id: number; title: string }> }>(request, "GET", "/api/admin/cases?pageSize=100");
  for (const caseItem of existingCases.items.filter((item) => item.title === "E2E 共享详情案例")) {
    await adminApi(request, "DELETE", `/api/admin/cases/${caseItem.id}`);
  }
  const detail = await createRichTextDetailPage(request, "E2E 共享详情案例页", "<p>E2E 案例详情正文</p>");
  await loginAdminUi(page);
  await page.getByTestId("sidebar-cases").click();
  await page.getByTestId("cases-create").click();
  await page.getByTestId("case-title").fill("E2E 共享详情案例");
  await page.getByTestId("case-category").fill("测试分类");
  await page.getByTestId("case-tag").fill("测试标签");
  await chooseMediaFromLibrary(page, "case-cover-select", /case-1\.png/);
  await page.getByTestId("case-summary").fill("后台自动化创建的精选案例");
  await fillControl(page.getByTestId("case-event-date"), "2026-07-09");
  await page.keyboard.press("Enter");
  await page.getByTestId("case-location").fill("杭州 E2E");
  await page.getByTestId("case-featured").click();
  await fillNumber(page, "case-featured-sort-order", 66);
  await fillNumber(page, "sort-order", 66);
  await selectOption(page, "status-select", "启用");
  await expect(page.getByTestId("detail-page-reference-select")).toBeVisible();
  await selectDetailPageReference(page, "E2E 共享详情案例页");
  await page.getByTestId("cases-save").click();
  await waitForToast(page, "保存成功");

  const cases = await adminApi<{ items: Array<{ id: number; title: string; detailPageId: number | null; detailPageType: string | null; detailPageSummary: { id: number; name: string; type: string } | null }> }>(request, "GET", "/api/admin/cases?pageSize=100");
  const created = cases.items.find((item) => item.title === "E2E 共享详情案例");
  expect(created?.detailPageId).toBe(detail.id);
  expect(created?.detailPageType).toBe("rich_text");
  expect(created?.detailPageSummary).toMatchObject({ id: detail.id, name: "E2E 共享详情案例页", type: "rich_text" });
  if (!created) throw new Error("新建案例未出现在后台列表接口");

  const row = page.getByTestId(`cases-row-${created.id}`);
  await expect(row).toContainText("单富文本");
  await row.getByTestId("cases-edit").click();
  await expect(page.getByTestId("detail-page-reference-select")).toContainText("E2E 共享详情案例页");
  await page.getByTestId("detail-page-reference-select").hover();
  await page.getByTestId("detail-page-reference-select").locator(".ant-select-clear").click();
  await page.getByTestId("cases-save").click();
  await waitForToast(page, "保存成功");
  const updatedCases = await adminApi<{ items: Array<{ id: number; detailPageId: number | null; detailPageSummary: unknown | null }> }>(request, "GET", "/api/admin/cases?pageSize=100");
  const updated = updatedCases.items.find((item) => item.id === created.id);
  expect(updated?.detailPageId).toBeNull();
  expect(updated?.detailPageSummary).toBeNull();
});

test("近日活动管理支持独立创建、详情引用、编辑和删除", async ({ page, request }) => {
  const existing = await adminApi<{ items: Array<{ id: number; title: string }> }>(
    request,
    "GET",
    "/api/admin/recent-activities?pageSize=100"
  );
  for (const item of existing.items.filter((record) => record.title.startsWith("E2E 近日活动"))) {
    await adminApi(request, "DELETE", `/api/admin/recent-activities/${item.id}`);
  }
  const detail = await createRichTextDetailPage(request, "E2E 近日活动详情页", "<p>E2E 近日活动正文</p>");

  await loginAdminUi(page);
  await page.getByTestId("sidebar-recent-activities").click();
  await page.getByTestId("recent-activities-create").click();
  await page.getByTestId("recent-activity-title").fill("E2E 近日活动");
  await page.getByTestId("recent-activity-tag").fill("发布会");
  await chooseMediaFromLibrary(page, "recent-activity-cover-select", /case-1\.png/);
  await page.getByTestId("recent-activity-summary").fill("后台自动化创建的近日活动");
  await fillControl(page.getByTestId("recent-activity-event-date"), "2020-01-01 09:30:00");
  await page.keyboard.press("Enter");
  await page.getByTestId("recent-activity-location").fill("杭州 E2E");
  await selectDetailPageReference(page, "E2E 近日活动详情页");
  await fillNumber(page, "sort-order", 88);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("recent-activities-save").click();
  await waitForToast(page, "保存成功");

  const records = await adminApi<{ items: Array<{ id: number; title: string; eventDate: string; detailPageId: number | null; status: string }> }>(
    request,
    "GET",
    "/api/admin/recent-activities?q=E2E&pageSize=100"
  );
  const created = records.items.find((item) => item.title === "E2E 近日活动");
  expect(created).toMatchObject({ detailPageId: detail.id, status: "enabled" });
  expect(created?.eventDate).toContain("2020-01-01");
  if (!created) throw new Error("新建近日活动未出现在后台列表接口");

  const row = page.getByTestId(`recent-activities-row-${created.id}`);
  await expect(row).toContainText("E2E 近日活动");
  await row.getByTestId("recent-activities-edit").click();
  await page.getByTestId("recent-activity-title").fill("E2E 近日活动更新");
  await page.getByTestId("recent-activities-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByTestId(`recent-activities-row-${created.id}`)).toContainText("E2E 近日活动更新");

  await adminApi(request, "DELETE", `/api/admin/recent-activities/${created.id}`);
});

test("文章管理支持分类输入、详情页引用、筛选、删除和菜单文章配置", async ({ page, request }) => {
  const existingArticles = await adminApi<{ items: Array<{ id: number; title: string }> }>(
    request,
    "GET",
    "/api/admin/articles?pageSize=100"
  );
  for (const article of existingArticles.items.filter((item) => item.title.startsWith("E2E 文章"))) {
    await adminApi(request, "DELETE", `/api/admin/articles/${article.id}`);
  }
  const existingMenus = await adminApi<{ items: Array<{ id: number; text: string }> }>(request, "GET", "/api/admin/menu-items");
  for (const menu of existingMenus.items.filter((item) => item.text === "E2E 文章菜单")) {
    await adminApi(request, "DELETE", `/api/admin/menu-items/${menu.id}`);
  }
  const detail = await createRichTextDetailPage(request, "E2E 文章详情页", "<p>E2E 文章详情正文</p>");

  await loginAdminUi(page);
  await page.getByTestId("sidebar-articles").click();
  await expect(page.getByRole("heading", { name: "文章管理" })).toBeVisible();
  await expect(page.getByTestId("articles-table")).toBeVisible();
  await page.getByTestId("articles-create").click();

  await page.getByTestId("article-title").fill("E2E 文章管理新分类");
  await page.getByTestId("article-category").fill("婚礼");
  await expect(visibleSelectOption(page, "婚礼攻略")).toBeVisible();
  await visibleSelectOption(page, "婚礼攻略").click();
  await expect(page.getByTestId("article-category")).toHaveValue("婚礼攻略");
  await page.getByTestId("article-category").fill("Ｅ２Ｅ   新分类");
  await chooseMediaFromLibrary(page, "article-cover-select", /case-1\.png/);
  await page.getByTestId("article-summary").fill("E2E 文章摘要会展示在首页和文章列表中。");
  await fillControl(page.getByTestId("article-published-at"), "2026-07-12 10:30:00");
  await page.keyboard.press("Enter");
  await page.getByTestId("article-featured").click();
  await fillNumber(page, "article-featured-sort-order", 33);
  await fillNumber(page, "article-sort-order", 33);
  await selectOption(page, "status-select", "启用");
  await selectDetailPageReference(page, "E2E 文章详情页");
  await page.getByTestId("articles-save").click();
  await waitForToast(page, "保存成功");

  const articles = await adminApi<{ items: Array<{ id: number; title: string; category: string; detailPageId: number | null; isFeatured: boolean }> }>(
    request,
    "GET",
    "/api/admin/articles?q=E2E%20文章管理&pageSize=100"
  );
  const created = articles.items.find((item) => item.title === "E2E 文章管理新分类");
  expect(created).toMatchObject({
    category: "E2E 新分类",
    detailPageId: detail.id,
    isFeatured: true
  });
  if (!created) throw new Error("E2E 文章未创建成功");

  const row = page.getByTestId(`articles-row-${created.id}`);
  await expect(row).toContainText("E2E 文章管理新分类");
  await row.getByTestId("articles-edit").click();
  await expect(page.getByTestId("article-category")).toHaveValue("E2E 新分类");
  await expect(page.getByTestId("detail-page-reference-select")).toContainText("E2E 文章详情页");

  await page.goto(adminPath("/articles"));
  await page.getByTestId("articles-category-filter").click();
  await expect(visibleSelectOption(page, "E2E 新分类")).toBeVisible();
  await visibleSelectOption(page, "E2E 新分类").click();
  await expect(page.getByTestId(`articles-row-${created.id}`)).toBeVisible();
  await selectOption(page, "articles-featured-filter", "精选");
  await expect(page.getByTestId(`articles-row-${created.id}`)).toBeVisible();

  await page.goto(adminPath("/menu-items"));
  await page.getByTestId("menu-items-create").click();
  await page.getByTestId("menu-text").fill("E2E 文章菜单");
  await chooseMediaFromLibrary(page, "menu-icon-select", /icon-case\.png/);
  await selectOption(page, "menu-type-select", "文章");
  await expect(page.getByTestId("menu-config-article-category")).toBeVisible();
  await page.getByTestId("menu-config-article-category").click();
  await page.keyboard.type("不存在分类");
  await expect(visibleSelectOption(page, "不存在分类")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await selectOption(page, "menu-config-article-category", "全部文章");
  await selectOption(page, "menu-config-article-category", "婚礼攻略");
  await fillNumber(page, "menu-config-article-page-size", 7);
  await fillNumber(page, "sort-order", 77);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("menu-items-save").click();
  await waitForToast(page, "保存成功");

  const menus = await adminApi<{ items: Array<{ id: number; text: string; type: string; configJson: { category?: string; pageSize?: number } }> }>(
    request,
    "GET",
    "/api/admin/menu-items"
  );
  const savedMenu = menus.items.find((item) => item.text === "E2E 文章菜单");
  expect(savedMenu).toMatchObject({
    type: "article",
    configJson: { category: "婚礼攻略", pageSize: 7 }
  });
  if (!savedMenu) throw new Error("E2E 文章菜单未创建成功");

  await page.goto(adminPath("/articles"));
  await page.getByTestId(`articles-row-${created.id}`).getByTestId("articles-delete").click();
  const deleteConfirm = page
    .getByRole("dialog")
    .filter({ hasText: `确认删除「${created.title}」？` });
  await expect(deleteConfirm).toBeVisible();
  await expect(deleteConfirm).toContainText(`记录 ID：${created.id}`);
  await deleteConfirm.getByRole("button", { name: /删\s*除/ }).click();
  await waitForToast(page, "删除成功");
  await adminApi(request, "DELETE", `/api/admin/menu-items/${savedMenu.id}`);
});

test("表单本地上传允许非推荐尺寸，引用资源不可删除", async ({ page, request }) => {
  const media = await adminApi<{ items: { id: number; resourceName: string }[] }>(request, "GET", "/api/admin/media-assets?pageSize=100");
  const referencedAssetId = media.items.find((item) => item.resourceName === "placeholder-icon.png")?.id;
  expect(referencedAssetId).toBeTruthy();
  if (!referencedAssetId) throw new Error("placeholder icon media asset is required for delete protection coverage");
  await adminApi(request, "POST", "/api/admin/menu-items", {
    text: "E2E 引用资源菜单",
    iconAssetId: referencedAssetId,
    type: "artist",
    configJson: { defaultSort: "sortOrder", pageSize: 1 },
    sortOrder: 1000,
    status: "disabled"
  });
  await loginAdminUi(page);
  await page.getByTestId("sidebar-banners").click();
  await page.getByTestId("banners-create").click();
  await page.getByTestId("banner-image-select-add").click();
  const popover = page.locator(".ant-popover:visible");
  await popover.getByTestId("media-action-upload").click();
  await popover.locator('input[type="file"]').setInputFiles({
    name: "wrong-size.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
  });
  const uploadDialog = page.getByRole("dialog").filter({ hasText: "上传资源" });
  await expect(uploadDialog).toBeVisible();
  await expect(page.getByText(/实际尺寸：1×1/)).toBeVisible();
  await uploadDialog.getByRole("button", { name: /取\s*消/ }).click();

  await page.locator(".ant-drawer-close").click();
  await page.getByTestId("sidebar-media-assets").click();
  const mediaSearch = page.getByTestId("media-search").locator("input");
  await mediaSearch.fill("placeholder-icon.png");
  await mediaSearch.press("Enter");
  await expect(page.getByRole("row", { name: /placeholder-icon\.png/ }).locator("img.media-thumb")).toHaveCSS("object-fit", "contain");
  await expect(page.getByTestId(`media-delete-${referencedAssetId}`)).toBeDisabled();
});

test("资源库上传、MD5复用、筛选和清理未使用资源", async ({ page, request }) => {
  const existingAssets = await adminApi<{ items: Array<{ id: number; resourceName: string }> }>(request, "GET", "/api/admin/media-assets?pageSize=100");
  for (const asset of existingAssets.items.filter((item) => item.resourceName === "E2E 未使用资源")) {
    await adminApi(request, "DELETE", `/api/admin/media-assets/${asset.id}`);
  }
  await page.route("**/api/admin/media-assets/tags", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { items: [{ label: "历史婚礼标签", count: 4 }, { label: "舞台标签", count: 2 }] },
      message: "ok"
    })
  }));
  await loginAdminUi(page);
  await page.getByTestId("sidebar-media-assets").click();
  await expect(page.getByRole("tab", { name: "图片" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "视频" })).toBeVisible();
  await expect(page.getByTestId("media-upload-button")).toBeEnabled();

  const uploadBuffer = await createUniqueLibraryUploadPng();
  const file = {
    name: "e2e-unused.png",
    mimeType: "image/png",
    buffer: uploadBuffer
  };
  const uploadChooser = page.waitForEvent("filechooser");
  await page.getByTestId("media-upload-button").click();
  await (await uploadChooser).setFiles(file);
  await expect(page.getByTestId("media-resource-name")).toBeVisible();
  await page.getByTestId("media-resource-name").fill("E2E 未使用资源");
  const tagSelect = page.getByTestId("media-resource-tags");
  await tagSelect.click();
  await page.keyboard.type("历史婚");
  await expect(visibleSelectOption(page, "历史婚礼标签 (4)")).toBeVisible();
  await expect(visibleSelectOption(page, "舞台标签 (2)")).toHaveCount(0);
  await visibleSelectOption(page, "历史婚礼标签 (4)").click();
  await tagSelect.click();
  await page.keyboard.type("E2E新标签");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByTestId("media-upload-button-confirm").click();
  await waitForToast(page, "上传成功");

  await page.getByTestId("media-search").locator("input").fill("E2E 未使用资源");
  await page.getByTestId("media-search").locator("input").press("Enter");
  const uploadedRow = page.getByRole("row", { name: /E2E 未使用资源/ });
  await expect(uploadedRow).toBeVisible();
  await expect(uploadedRow).toContainText("历史婚礼标签");
  await expect(uploadedRow).toContainText("E2E新标签");

  await page.getByTestId("media-upload-button-input").setInputFiles(file);
  await waitForToast(page, "已存在相同资源，已直接复用");

  await page.getByTestId("media-clean-unused").click();
  await expect(page.getByTestId("media-clean-modal")).toBeVisible();
  const row = page.getByTestId("media-clean-modal").getByRole("row", { name: /E2E 未使用资源/ });
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "删除所选资源" }).click();
  await expect(page.getByText(/已删除 1 项/).last()).toBeVisible();
});

test("EdgeOne 预热仅提交一次并在窄屏显示可恢复状态", async ({ page }) => {
  await loginAdminUi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  let triggerCalls = 0;
  let status: "failed" | "success" = "failed";
  const safeFailureReason = "CAM 子账号缺少预热查询权限";
  const asset = {
    id: 901,
    resourceName: "edgeone-prefetch.jpg",
    originalName: "edgeone-prefetch.jpg",
    filename: "edgeone-prefetch.jpg",
    md5: "0123456789abcdef0123456789abcdef",
    mimeType: "image/jpeg",
    mediaType: "image",
    url: "/uploads/edgeone-prefetch.jpg",
    width: 710,
    height: 290,
    size: 1024,
    storageType: "local",
    createdBy: 1,
    createdByName: "admin",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    tags: [],
    inUse: false,
    referenceCount: 0
  };

  await page.route("**/api/admin/media-assets/tags", (route) =>
    route.fulfill({ json: { success: true, data: { items: [] }, message: "ok" } })
  );
  await page.route("**/api/admin/media-assets?*", (route) =>
    route.fulfill({
      json: { success: true, data: { items: [asset], total: 1, page: 1, pageSize: 20 }, message: "ok" }
    })
  );
  await page.route("**/api/admin/edgeone/prefetch?*", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          items: [{
            id: 1,
            mediaAssetId: asset.id,
            contentVersion: asset.md5,
            targetUrl: "https://media.example.com/uploads/edgeone-prefetch.jpg",
            mode: "default",
            status,
            attemptCount: 1,
            nextRetryAt: null,
            lastSubmittedAt: "2026-07-17T00:00:00.000Z",
            completedAt: status === "success" ? "2026-07-17T00:00:10.000Z" : null,
            safeErrorCode: status === "failed" ? "EDGEONE_PERMISSION_DENIED" : null,
            safeErrorMessage: status === "failed" ? safeFailureReason : null,
            updatedAt: "2026-07-17T00:00:10.000Z"
          }],
          total: 1,
          page: 1,
          pageSize: 100
        },
        message: "ok"
      }
    })
  );
  await page.route("**/api/admin/edgeone/prefetch/reconcile", async (route) => {
    status = "success";
    await route.fulfill({
      json: {
        success: true,
        data: { scanned: 1, queried: 1, recovered: 0, retried: 0, failed: 0 },
        message: "ok"
      }
    });
  });
  await page.route("**/api/admin/edgeone/prefetch", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    triggerCalls += 1;
    await route.fulfill({
      json: {
        success: true,
        data: {
          submitted: 1,
          skipped: 0,
          ineligible: 0,
          failed: 0,
          items: [{ mediaAssetId: asset.id, status: "processing", outcome: "submitted", safeErrorCode: null }]
        },
        message: "ok"
      }
    });
  });

  await page.goto(adminPath("/media-assets"));
  await expect(page.getByText("预热失败")).toBeVisible();
  await expect(page.getByTitle(`EDGEONE_PERMISSION_DENIED：${safeFailureReason}`)).toBeVisible();
  const trigger = page.getByTestId("media-edgeone-prefetch");
  await trigger.dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const confirm = page.getByRole("button", { name: "开始预热" });
  await confirm.dblclick();
  await expect(page.getByTestId("media-edgeone-prefetch-summary")).toContainText("本次提交 1");
  expect(triggerCalls).toBe(1);

  await page.getByTestId("media-edgeone-prefetch-refresh").click();
  await expect(page.getByText("预热成功")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({
    local: localStorage,
    session: sessionStorage,
    href: location.href
  }))).not.toContain("PREFETCH_TEST_SECRET");
});

test("备份与恢复后台可走真实创建、删除、导入预检和恢复链路", async ({ page, request }) => {
  const runId = `E2E-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const sourceNote = `${runId} 恢复源备份`;
  const removableNote = `${runId} 待删除备份`;
  const uiCreateNote = `${runId} UI 创建备份`;
  const source = await adminApi<{ backup: BackupSummary }>(request, "POST", "/api/admin/backups", {
    note: sourceNote
  });
  const removable = await adminApi<{ backup: BackupSummary }>(request, "POST", "/api/admin/backups", {
    note: removableNote
  });

  const uiToken = await adminToken(request);
  await proxyBackupApiThroughPlaywright(page, request);
  await page.goto(adminPath("/login"));
  await page.evaluate((token) => localStorage.setItem("eventarts.admin.token", token), uiToken);
  await page.goto(adminPath("/backups"));
  await expect(page.getByRole("heading", { level: 2, name: "备份与恢复" })).toBeVisible();
  await expect(page.getByTestId("sidebar-backups")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(source.backup.id) })).toBeVisible();
  expect(source.backup).toMatchObject({ formatVersion: 3, backupKind: "manual", dataScope: "non_identity" });
  await expect(page.getByText("身份恢复")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "类型" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "数据范围" })).toBeVisible();
  const sourceRow = page.getByRole("row", { name: new RegExp(source.backup.id) });
  await expect(sourceRow).toContainText("手动备份");
  await expect(sourceRow).toContainText("不含身份数据");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId(`backup-download-${source.backup.id}`).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${source.backup.id}.tar.gz`);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const archive = await readFile(downloadedPath!);
  expect(archive.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  await waitForToast(page, "备份下载已开始");

  await page.getByTestId(`backup-delete-${removable.backup.id}`).click();
  const deleteDialog = page.getByRole("dialog").filter({ hasText: "确认删除备份？" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText(removable.backup.id);
  await deleteDialog.getByRole("button", { name: /删\s*除\s*备\s*份/ }).click();
  await waitForToast(page, "备份已删除");
  const afterDelete = await adminApi<{ backups: BackupSummary[] }>(request, "GET", "/api/admin/backups");
  expect(afterDelete.backups.some((backup) => backup.id === removable.backup.id)).toBe(false);

  await page.getByTestId("backup-create-open").click();
  const createDialog = page.getByRole("dialog").filter({ hasText: "创建备份" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByTestId("backup-create-note").fill(uiCreateNote);
  await createDialog.getByRole("button", { name: /创\s*建/ }).click();
  await waitForToast(page, "备份已创建");
  await expect(page.getByRole("row", { name: uiCreateNote })).toBeVisible();

  const importResponsePromise = page.waitForResponse((response) => response.url().includes("/api/admin/backups/import"));
  await page.getByTestId("backup-import-input").setInputFiles({
    name: "e2e-backup.tar.gz",
    mimeType: "application/gzip",
    buffer: archive
  });
  const importResponse = await importResponsePromise;
  const importBody = await importResponse.json();
  expect(importBody.success, JSON.stringify(importBody)).toBe(true);
  const importedBackupId = importBody.data.backup.id as string;
  const preflight = page.getByTestId("backup-import-preflight");
  await expect(preflight).toBeVisible();
  await expect(preflight).toContainText("外部归档");
  await expect(preflight).toContainText("导入归档");
  await expect(preflight).toContainText("不含身份数据");
  await expect(preflight).toContainText("v3 非身份备份只包含业务数据与 uploads");
  await expect(preflight).toContainText("清单：通过");
  await expect(preflight).not.toContainText("身份恢复");
  await expect(preflight).not.toContainText("manifest.json");
  await expect(preflight).not.toContainText("database.sqlite");

  const oldToken = uiToken;
  await page.getByRole("button", { name: /恢\s*复\s*此\s*备\s*份/ }).click();
  const restoreDialog = page.getByTestId("backup-restore-modal");
  await expect(restoreDialog).toBeVisible();
  await expect(restoreDialog).toContainText("v3 非身份备份只包含业务数据与 uploads");
  await expect(restoreDialog).toContainText("不含身份数据");
  await expect(restoreDialog).toContainText("当前后台会话和未使用重置链接都会失效");
  await expect(restoreDialog).not.toContainText("身份恢复");
  await page.getByTestId("backup-restore-confirmation").fill("RESTORE_FULL_BACKUP");
  const restoreResponsePromise = page.waitForResponse((response) =>
    response.url().includes(`/api/admin/backups/${importedBackupId}/restore`)
  );
  await page.getByRole("button", { name: /确\s*认\s*恢\s*复/ }).click();
  const restoreResponse = await restoreResponsePromise;
  const restoreBody = await restoreResponse.json();
  expect(restoreBody.success, JSON.stringify(restoreBody)).toBe(true);
  await expect(page).toHaveURL(/\/admin\/login$/, { timeout: 45_000 });

  const oldTokenResponse = await request.get(`${apiBase}/api/admin/auth/me`, {
    headers: { authorization: `Bearer ${oldToken}` }
  });
  expect(oldTokenResponse.status()).toBe(401);
  await expect(oldTokenResponse.json()).resolves.toMatchObject({
    success: false,
    error: { code: "UNAUTHORIZED" }
  });

  expect(await adminToken(request)).toBeTruthy();
});

test("后台布局横向滚动只作用于右侧表格内容", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await loginAdminUi(page);
  await page.evaluate(() => localStorage.setItem("event-arts-admin-sider-collapsed", "false"));

  for (const target of [
    { path: adminPath("/artists"), title: "人员管理", tableTestId: "artists-table", actionTestId: "artists-create" },
    { path: adminPath("/media-assets"), title: "素材库", tableTestId: "media-table", actionTestId: "media-upload-button" },
    { path: adminPath("/detail-pages"), title: "详情页管理", tableTestId: "detail-page-table", actionTestId: "detail-page-create" }
  ]) {
    await expectTableHorizontalScrollIsScoped(page, target);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(adminPath("/artists"));
  await expect(page.getByTestId("artists-table")).toBeVisible();
  await expectNoDocumentHorizontalScroll(page);
});

test("后台分层导航和表单视觉截图", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAdminUi(page);
  await page.screenshot({ path: "docs/design/admin-navigation-expanded.png", fullPage: true });

  await page.getByTestId("sidebar-collapse").click();
  await expect(page.getByLabel("展开侧边栏")).toBeVisible();
  await page.screenshot({ path: "docs/design/admin-navigation-collapsed.png", fullPage: true });

  await page.evaluate(() => localStorage.setItem("event-arts-admin-sider-collapsed", "false"));
  await page.goto(adminPath("/artists/new"));
  await expect(page.getByTestId("artist-name")).toBeVisible();
  await page.screenshot({ path: "docs/design/admin-artist-editor.png", fullPage: true });

  await page.goto(adminPath("/cases/new"));
  await expect(page.getByTestId("case-title")).toBeVisible();
  await page.screenshot({ path: "docs/design/admin-case-editor.png", fullPage: true });

  await page.goto(adminPath("/announcements"));
  await page.getByTestId("announcements-create").click();
  await expect(page.getByTestId("announcements-drawer")).toBeVisible();
  await page.screenshot({ path: "docs/design/admin-announcement-drawer.png", fullPage: true });

  await page.locator(".ant-drawer-close").click();
  await page.goto(adminPath("/media-assets"));
  await expect(page.getByTestId("media-table")).toBeVisible();
  await page.screenshot({ path: "docs/design/admin-media-list.png", fullPage: true });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(adminPath("/artists"));
  await expect(page.getByTestId("artists-table")).toBeVisible();
  await page.screenshot({ path: "docs/design/admin-responsive-1024.png", fullPage: true });
});
