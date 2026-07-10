import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { adminApi, apiBase, clientApi } from "./helpers";

type AdminList<T> = { items: T[] };
type Announcement = { id: number; summary: string; content: string; displayDurationMs: number; sortOrder: number; status: string };
type Banner = { id: number; status: string };
type Menu = { id: number; text: string; status: string };
type CaseItem = { id: number; title: string; status: string; isFeatured: boolean };
type HomeResponse = {
  site: {
    appName: string;
    subtitle: string;
    defaultBannerUrl: string;
    placeholderBannerUrl: string;
  };
  announcements: Announcement[];
};

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent =
      "#react-refresh-overlay,#webpack-dev-server-client-overlay{display:none!important;pointer-events:none!important;}";
    document.documentElement.appendChild(style);
    window.addEventListener(
      "unhandledrejection",
      (event) => {
        if (!(event.reason instanceof Error)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );
  });
});

async function setAnnouncementStatus(request: APIRequestContext, status: "enabled" | "disabled") {
  const data = await adminApi<AdminList<Announcement>>(request, "GET", "/api/admin/announcements");
  await Promise.all(data.items.map((item) => adminApi(request, "PUT", `/api/admin/announcements/${item.id}`, { status })));
}

async function setBannerStatus(request: APIRequestContext, status: "enabled" | "disabled") {
  const data = await adminApi<AdminList<Banner>>(request, "GET", "/api/admin/banners");
  await Promise.all(data.items.map((item) => adminApi(request, "PUT", `/api/admin/banners/${item.id}`, { status })));
}

async function createAnnouncement(request: APIRequestContext, summary: string, sortOrder: number) {
  return adminApi<Announcement>(request, "POST", "/api/admin/announcements", {
    summary,
    content: `${summary} 内容`,
    displayDurationMs: 300,
    sortOrder,
    status: "enabled"
  });
}

async function prepareDesignReviewData(request: APIRequestContext) {
  const site = await adminApi<Record<string, unknown>>(request, "GET", "/api/admin/site-config");
  await adminApi(request, "PUT", "/api/admin/site-config", {
    ...site,
    appName: "喜缘主持・演艺服务",
    subtitle: "专业主持人・歌手・演艺团队"
  });

  const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
  await Promise.all(
    menus.items
      .filter((item) => item.text.startsWith("E2E"))
      .map((item) => adminApi(request, "PUT", `/api/admin/menu-items/${item.id}`, { status: "disabled" }))
  );

  const cases = await adminApi<AdminList<CaseItem>>(request, "GET", "/api/admin/cases");
  await Promise.all(
    cases.items
      .filter((item) => item.title.startsWith("E2E"))
      .map((item) => adminApi(request, "PUT", `/api/admin/cases/${item.id}`, { status: "disabled", isFeatured: false }))
  );
}

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("miniapp-home")).toBeVisible();
  await clearDevOverlay(page);
}

async function clearDevOverlay(page: Page) {
  await page
    .locator("#react-refresh-overlay, #webpack-dev-server-client-overlay")
    .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
}

async function tap(page: Page, locator: Locator) {
  await clearDevOverlay(page);
  await locator.click({ force: true });
}

test("首页成功加载，小程序名和副标题来自接口", async ({ page, request }) => {
  const home = await clientApi<HomeResponse>(request, "/api/client/home");
  await openHome(page);
  await expect(page.getByTestId("home-app-name")).toHaveText(home.site.appName);
  await expect(page.getByTestId("home-subtitle")).toHaveText(home.site.subtitle);
});

test("首页 H5 顶部留白接近参考图", async ({ page }) => {
  await openHome(page);
  const metrics = await page.evaluate(() => {
    const getRect = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`Missing ${selector}`);
      return node.getBoundingClientRect();
    };

    const title = getRect('[data-testid="home-app-name"]');
    const banner = getRect('[data-testid="home-banner"]');
    return {
      titleTop: title.top,
      bannerTop: banner.top,
      bannerRatio: banner.width / banner.height
    };
  });

  expect(metrics.titleTop).toBeLessThanOrEqual(44);
  expect(metrics.bannerTop).toBeLessThanOrEqual(138);
  expect(metrics.bannerRatio).toBeCloseTo(710 / 290, 1);
});

test("首页案例卡片高度接近参考图", async ({ page }) => {
  await openHome(page);
  const firstCaseHeight = await page.getByTestId("home-case-card").first().evaluate((node) => node.getBoundingClientRect().height);

  expect(firstCaseHeight).toBeLessThanOrEqual(220);
});

test("无公告时公告栏隐藏", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toHaveCount(0);
});

test("有公告时展示公告栏，多公告有切换动画类名", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await createAnnouncement(request, "E2E 第一条公告", 100);
  await createAnnouncement(request, "E2E 第二条公告", 101);
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toBeVisible();
  await expect(page.getByTestId("home-announcement")).toContainText(/E2E 第一条公告|E2E 第二条公告/);
  await expect(page.getByTestId("home-announcement")).toHaveClass(/notice--flip/);
});

test("无 Banner 时显示默认图且有指示点", async ({ page, request }) => {
  await setBannerStatus(request, "disabled");
  await openHome(page);
  await expect(page.getByTestId("home-banner")).toBeVisible();
  await expect(page.getByTestId("home-banner-image").first()).toHaveAttribute("data-current-src", /\/uploads\/seed\/[a-f\d]{32}\.png$/);
  await expect(page.getByTestId("home-banner-dots")).toContainText("•");
});

test("菜单展示五种类型并能跳转", async ({ page }) => {
  const artistTypes = [
    ["host", /人员列表 host/],
    ["singer", /人员列表 singer/],
    ["actor", /人员列表 actor/]
  ] as const;

  for (const [type, heading] of artistTypes) {
    await openHome(page);
    const menu = page.getByTestId(`home-menu-${type}`).first();
    await expect(menu).toBeVisible();
    await tap(page, menu);
    await expect(page.getByText(heading)).toBeVisible();
    await expect(page.getByTestId(`artist-list-page-${type}`)).toBeVisible();
  }

  await openHome(page);
  const caseMenu = page.getByTestId("home-menu-activity_case").first();
  await expect(caseMenu).toBeVisible();
  await tap(page, caseMenu);
  await expect(page.getByTestId("case-list-page")).toBeVisible();

  await openHome(page);
  const contactMenu = page.getByTestId("home-menu-contact").first();
  await expect(contactMenu).toBeVisible();
  await tap(page, contactMenu);
  await expect(page.getByTestId("contact-page")).toBeVisible();
});

test("精选案例展示并可进入详情页", async ({ page }) => {
  await openHome(page);
  await expect(page.locator(".section-heading__title").filter({ hasText: "精选案例" })).toBeVisible();
  await expect(page.getByTestId("home-featured-cases")).toBeVisible();
  await expect(page.getByTestId("home-case-card").first()).toBeVisible();
  await tap(page, page.getByTestId("home-case-card").first());
  await expect(page.getByTestId("case-detail-page")).toBeVisible();
});

test("首页接口失败展示异常页，重新加载可恢复", async ({ page }) => {
  await page.route(`${apiBase}/api/client/home`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "E2E_FAIL", message: "E2E failure" } })
    })
  );
  await page.goto("/");
  await expect(page.getByTestId("home-error-state")).toBeVisible();
  await expect(page.getByText("页面加载失败")).toBeVisible();
  await page.unroute(`${apiBase}/api/client/home`);
  await tap(page, page.getByTestId("home-reload"));
  await expect(page.getByTestId("miniapp-home")).toBeVisible();
});

test("图片失败时使用占位图", async ({ page, request }) => {
  await setBannerStatus(request, "disabled");
  const home = await clientApi<HomeResponse>(request, "/api/client/home");
  await page.route(home.site.defaultBannerUrl, (route) => route.abort());
  await openHome(page);
  await expect(page.getByTestId("home-banner-image").first()).toHaveAttribute("data-current-src", home.site.placeholderBannerUrl);
  await page.unroute(home.site.defaultBannerUrl);
});

test("设计复核截图", async ({ page, request }) => {
  await prepareDesignReviewData(request);
  await setAnnouncementStatus(request, "enabled");
  await setBannerStatus(request, "enabled");
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toBeVisible();
  await expect(page.getByTestId("home-banner")).toBeVisible();
  await expect(page.getByTestId("home-menu")).toBeVisible();
  await expect(page.getByTestId("home-featured-cases")).toBeVisible();
  await page.screenshot({ path: "docs/design/actual-home-h5.png", fullPage: true });
});
