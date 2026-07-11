import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { adminApi, apiBase, clientApi } from "./helpers";

type AdminList<T> = { items: T[] };
type Announcement = {
  id: number;
  summary: string;
  content: string;
  displayDurationMs: number;
  sortOrder: number;
  status: string;
  detailPageId: number | null;
};
type Banner = { id: number; status: string; detailPageId: number | null };
type MediaAsset = { id: number; resourceName: string };
type Menu = { id: number; text: string; status: string };
type CaseItem = { id: number; title: string; status: string; isFeatured: boolean };
type ArtistListItem = { id: number; name: string; type: "host" | "singer" | "actor"; detailPageId: number | null };
type CaseListItem = { id: number; title: string; detailPageId: number | null };
type LinkedArtistListItem = ArtistListItem & { detailPageId: number };
type LinkedCaseListItem = CaseListItem & { detailPageId: number };
type DetailFixtures = {
  artistBanner: LinkedArtistListItem;
  artistRich: LinkedArtistListItem;
  caseBanner: LinkedCaseListItem;
  caseRich: LinkedCaseListItem;
};
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
    (
      globalThis as typeof globalThis & { __TARO_DETAIL_E2E_FIXED__?: boolean }
    ).__TARO_DETAIL_E2E_FIXED__ = true;
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
  await Promise.all(
    data.items.map((item) =>
      adminApi(request, "PUT", `/api/admin/announcements/${item.id}`, { status })
    )
  );
}

async function setBannerStatus(request: APIRequestContext, status: "enabled" | "disabled") {
  const data = await adminApi<AdminList<Banner>>(request, "GET", "/api/admin/banners");
  await Promise.all(
    data.items.map((item) => adminApi(request, "PUT", `/api/admin/banners/${item.id}`, { status }))
  );
}

async function createRichTextDetailPage(request: APIRequestContext, name: string, richTextHtml: string) {
  return adminApi<{ id: number; name: string; type: string }>(request, "POST", "/api/admin/detail-pages", {
    name,
    type: "rich_text",
    richTextHtml
  });
}

async function createAnnouncement(
  request: APIRequestContext,
  summary: string,
  sortOrder: number,
  displayDurationMs = 300,
  detailPageId: number | null = null
) {
  return adminApi<Announcement>(request, "POST", "/api/admin/announcements", {
    summary,
    content: `${summary} 内容`,
    displayDurationMs,
    detailPageId,
    sortOrder,
    status: "enabled"
  });
}

async function createBanner(
  request: APIRequestContext,
  input: { title: string; imageAssetId: number; sortOrder: number; switchDurationMs: number; detailPageId?: number | null }
) {
  return adminApi<Banner>(request, "POST", "/api/admin/banners", {
    title: input.title,
    imageAssetId: input.imageAssetId,
    detailPageId: input.detailPageId ?? null,
    switchDurationMs: input.switchDurationMs,
    sortOrder: input.sortOrder,
    status: "enabled"
  });
}

async function resolveHomeBannerAssets(request: APIRequestContext) {
  const data = await adminApi<AdminList<MediaAsset>>(request, "GET", "/api/admin/media-assets?mediaType=image&pageSize=100");
  const names = ["banner-default.png", "placeholder-banner.png"];
  const assets = names.map((name) => data.items.find((item) => item.resourceName === name));
  if (assets.some((asset) => !asset)) throw new Error("首页 BANNER 种子资源缺失");
  return assets as [MediaAsset, MediaAsset];
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
      .map((item) =>
        adminApi(request, "PUT", `/api/admin/menu-items/${item.id}`, { status: "disabled" })
      )
  );

  const cases = await adminApi<AdminList<CaseItem>>(request, "GET", "/api/admin/cases");
  await Promise.all(
    cases.items
      .filter((item) => item.title.startsWith("E2E"))
      .map((item) =>
        adminApi(request, "PUT", `/api/admin/cases/${item.id}`, {
          status: "disabled",
          isFeatured: false
        })
      )
  );

  const artists = await adminApi<AdminList<{ id: number; name: string }>>(
    request,
    "GET",
    "/api/admin/artists?pageSize=100"
  );
  await Promise.all(
    artists.items
      .filter((item) => item.name === "E2E 人员管理演员")
      .map((item) => adminApi(request, "DELETE", `/api/admin/artists/${item.id}`))
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

async function swipeHorizontally(page: Page, locator: Locator, direction: "left" | "right") {
  await clearDevOverlay(page);
  const box = await locator.boundingBox();
  if (!box) throw new Error("待滑动元素不可见");
  const client = await page.context().newCDPSession(page);
  const startX = box.x + box.width * (direction === "left" ? 0.78 : 0.22);
  const endX = box.x + box.width * (direction === "left" ? 0.22 : 0.78);
  const y = box.y + box.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y }]
  });
  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX + ((endX - startX) * step) / 6, y }]
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

async function resolveDetailFixtures(request: APIRequestContext): Promise<DetailFixtures> {
  const artists = await clientApi<ArtistListItem[]>(request, "/api/client/artists?type=host");
  const cases = await clientApi<CaseListItem[]>(request, "/api/client/cases");
  const artistBanner = artists.find((item) => item.name === "林然");
  const artistRich = artists.find((item) => item.name === "Jessica");
  const caseBanner = cases.find((item) => item.title === "浪漫粉色系户外婚礼");
  const caseRich = cases.find((item) => item.title === "企业年会歌手演出");
  if (
    !artistBanner?.detailPageId ||
    !artistRich?.detailPageId ||
    !caseBanner?.detailPageId ||
    !caseRich?.detailPageId
  ) {
    throw new Error("详情页 E2E seed 不完整；请先运行 pnpm db:seed");
  }
  return {
    artistBanner: artistBanner as LinkedArtistListItem,
    artistRich: artistRich as LinkedArtistListItem,
    caseBanner: caseBanner as LinkedCaseListItem,
    caseRich: caseRich as LinkedCaseListItem
  };
}

function detailRoute(id: number) {
  return `/#/pages/detail/index?id=${id}`;
}

async function openDetail(page: Page, id: number) {
  await page.goto(detailRoute(id));
  await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
  await clearDevOverlay(page);
}

async function waitForDetailVisuals(page: Page) {
  await expect(page.getByTestId("detail-rich-content")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all(
      Array.from(document.images).map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) return resolve();
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          })
      )
    );
  });
}

async function expectCommonDetailQuality(page: Page) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  await expect(page.getByText(/收藏|分享|在线咨询|立即预约/)).toHaveCount(0);
  await expect(
    page.locator('[class*="fixed-bottom"], [class*="business-action"], [class*="booking-bar"]')
  ).toHaveCount(0);

  const bottom = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="detail-rich-content"]');
    const pageRoot = document.querySelector(".detail-page");
    if (!content || !pageRoot) throw new Error("详情页内容节点不存在");
    return {
      trailingSpace:
        pageRoot.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom,
      contentPaddingBottom: Number.parseFloat(
        getComputedStyle(content.parentElement!).paddingBottom
      )
    };
  });
  expect(bottom.trailingSpace).toBeGreaterThanOrEqual(8);
  expect(bottom.trailingSpace).toBeLessThanOrEqual(44);
  expect(bottom.contentPaddingBottom).toBeLessThanOrEqual(32);
}

async function expectBannerDetail(page: Page, expectedTitle: string, expectedType: string) {
  await expect(page.getByTestId("detail-layout-banner")).toBeVisible();
  await expect(page.getByTestId("detail-banner")).toBeVisible();
  await expect(page.getByTestId("detail-hero")).toContainText(expectedTitle);
  await expect(page.getByTestId("detail-hero")).toContainText(expectedType);
  await expect(page.getByTestId("detail-banner-counter")).toHaveText(/^1\/\d+$/);
  const overlap = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="detail-banner"]')!.getBoundingClientRect();
    const content = document
      .querySelector('[data-testid="detail-content-overlap"]')!
      .getBoundingClientRect();
    const firstCard = document.querySelector(".ea-detail-card")!.getBoundingClientRect();
    return {
      amount: banner.bottom - content.top,
      firstCardVisible: firstCard.top >= content.top - 1
    };
  });
  expect(overlap.amount).toBeGreaterThanOrEqual(18);
  expect(overlap.amount).toBeLessThanOrEqual(28);
  expect(overlap.firstCardVisible).toBeTruthy();
}

async function expectRichOnlyDetail(page: Page, expectedTitle: string) {
  await expect(page.getByTestId("detail-layout-rich-only")).toBeVisible();
  await expect(page.getByTestId("detail-navigation")).toContainText(expectedTitle);
  await expect(page.getByTestId("detail-banner")).toHaveCount(0);
  await expect(page.getByTestId("detail-hero")).toHaveCount(0);
  await expect(page.getByTestId("detail-banner-counter")).toHaveCount(0);
  await expect(page.getByTestId("detail-content-overlap")).toHaveCount(0);
  await expect(page.locator(".detail-skeleton__banner")).toHaveCount(0);
  const geometry = await page.evaluate(() => {
    const navigation = document
      .querySelector('[data-testid="detail-navigation"]')!
      .getBoundingClientRect();
    const content = document.querySelector('[data-testid="detail-content-normal"]')!;
    const richContent = document.querySelector('[data-testid="detail-rich-content"]')!;
    const rect = richContent.getBoundingClientRect();
    return {
      gap: rect.top - navigation.bottom,
      marginTop: Number.parseFloat(getComputedStyle(content).marginTop)
    };
  });
  expect(geometry.marginTop).toBe(0);
  expect(geometry.gap).toBeGreaterThanOrEqual(10);
  expect(geometry.gap).toBeLessThanOrEqual(24);
}

async function expectDetailBackFallback(page: Page, fallbackTestId: string) {
  await tap(page, page.getByTestId("detail-back-button"));
  await expect(page.getByTestId(fallbackTestId)).toBeVisible();
}

async function createDetailComparison(actualPath: string) {
  const referencePath = "docs/design/reference-artist-detail-original.png";
  const actualMetadata = await sharp(actualPath).metadata();
  const referenceMetadata = await sharp(referencePath).metadata();
  if (
    !actualMetadata.width ||
    !actualMetadata.height ||
    !referenceMetadata.width ||
    !referenceMetadata.height
  ) {
    throw new Error("详情页视觉对比图片尺寸无效");
  }
  const alignedReferenceHeight = Math.round(
    (referenceMetadata.height * actualMetadata.width) / referenceMetadata.width
  );
  const comparisonHeight = Math.min(actualMetadata.height, alignedReferenceHeight);
  const reference = await sharp(referencePath)
    .resize({ width: actualMetadata.width })
    .extract({ left: 0, top: 0, width: actualMetadata.width, height: comparisonHeight })
    .png()
    .toBuffer();
  const actual = await sharp(actualPath)
    .extract({ left: 0, top: 0, width: actualMetadata.width, height: comparisonHeight })
    .png()
    .toBuffer();
  const halfOpacityActual = await sharp(actual).removeAlpha().ensureAlpha(0.5).png().toBuffer();
  await sharp(reference)
    .composite([{ input: halfOpacityActual, blend: "over" }])
    .png()
    .toFile("docs/design/overlay-artist-detail.png");
  await sharp(reference)
    .composite([{ input: actual, blend: "difference" }])
    .png()
    .toFile("docs/design/diff-artist-detail.png");

  const artifacts = [
    "docs/design/actual-artist-banner-rich-text.png",
    "docs/design/actual-artist-rich-text.png",
    "docs/design/actual-case-banner-rich-text.png",
    "docs/design/actual-case-rich-text.png",
    "docs/design/overlay-artist-detail.png",
    "docs/design/diff-artist-detail.png"
  ];
  const hashes = Object.fromEntries(
    await Promise.all(
      artifacts.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex")
      ])
    )
  );
  await writeFile(
    "docs/design/detail-page-visual-evidence.json",
    `${JSON.stringify(
      {
        viewport: { width: 427, height: 922, deviceScaleFactor: 2 },
        alignment:
          "Reference resized proportionally to actual width; both images top-aligned and cropped to the shorter height; no region masked.",
        hashes
      },
      null,
      2
    )}\n`
  );
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
  const firstCaseHeight = await page
    .getByTestId("home-case-card")
    .first()
    .evaluate((node) => node.getBoundingClientRect().height);

  expect(firstCaseHeight).toBeLessThanOrEqual(220);
});

test("无公告时公告栏隐藏", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toHaveCount(0);
});

test("多条公告按相同时长持续自动循环切换", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await createAnnouncement(request, "E2E 第一条公告", 100, 700);
  await createAnnouncement(request, "E2E 第二条公告", 101, 700);
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toBeVisible();
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "0");
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "1", { timeout: 2500 });
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "0", { timeout: 2500 });
});

test("公告与 BANNER 支持双向手动滑动且不会误触跳转", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await setBannerStatus(request, "disabled");
  const detail = await createRichTextDetailPage(request, `E2E 手滑详情 ${Date.now()}`, "<p>E2E 手滑详情正文</p>");
  await createAnnouncement(request, "E2E 手滑公告一", 700, 60_000, detail.id);
  await createAnnouncement(request, "E2E 手滑公告二", 701, 60_000);
  const [firstAsset, secondAsset] = await resolveHomeBannerAssets(request);
  await createBanner(request, {
    title: "E2E 手滑 BANNER 一",
    imageAssetId: firstAsset.id,
    sortOrder: 700,
    switchDurationMs: 60_000,
    detailPageId: detail.id
  });
  await createBanner(request, {
    title: "E2E 手滑 BANNER 二",
    imageAssetId: secondAsset.id,
    sortOrder: 701,
    switchDurationMs: 60_000,
    detailPageId: detail.id
  });
  await openHome(page);

  const announcement = page.getByTestId("home-announcement");
  await swipeHorizontally(page, announcement, "left");
  await expect(announcement).toHaveAttribute("data-current-index", "1");
  await expect(page).toHaveURL(/#\/pages\/index\/index$/);
  await swipeHorizontally(page, announcement, "right");
  await expect(announcement).toHaveAttribute("data-current-index", "0");
  await expect(page).toHaveURL(/#\/pages\/index\/index$/);

  const banner = page.getByTestId("home-banner");
  const bannerState = page.getByTestId("home-banner-state");
  await expect(banner.locator(".swiper-pagination-bullet")).toHaveCount(2);
  await swipeHorizontally(page, banner, "left");
  await expect(bannerState).toHaveAttribute("data-current-index", "1");
  await expect(banner.locator(".swiper-pagination-bullet-active")).toHaveCount(1);
  await expect(page).toHaveURL(/#\/pages\/index\/index$/);
  await swipeHorizontally(page, banner, "right");
  await expect(bannerState).toHaveAttribute("data-current-index", "0");
  await expect(page).toHaveURL(/#\/pages\/index\/index$/);
});

test("单条公告和 BANNER 保持静止且公告点击仍可进入详情", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await setBannerStatus(request, "disabled");
  const detail = await createRichTextDetailPage(request, `E2E 单条公告详情 ${Date.now()}`, "<p>E2E 单条公告详情正文</p>");
  await createAnnouncement(request, "E2E 单条公告", 800, 400, detail.id);
  const [bannerAsset] = await resolveHomeBannerAssets(request);
  await createBanner(request, {
    title: "E2E 单条 BANNER",
    imageAssetId: bannerAsset.id,
    sortOrder: 800,
    switchDurationMs: 400
  });
  await openHome(page);
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "0");
  await expect(page.getByTestId("home-banner-state")).toHaveAttribute("data-current-index", "0");
  await tap(page, page.locator(".notice__slide").first());
  await expect(page).toHaveURL(new RegExp(`/pages/detail/index\\?id=${detail.id}$`));
});

test("无 Banner 时显示默认图且有指示点", async ({ page, request }) => {
  await setBannerStatus(request, "disabled");
  await openHome(page);
  await expect(page.getByTestId("home-banner")).toBeVisible();
  await expect(page.getByTestId("home-banner-image").first()).toHaveAttribute(
    "data-current-src",
    /\/uploads\/seed\/[a-f\d]{32}\.png$/
  );
  await expect(page.getByTestId("home-banner").locator(".swiper-pagination-bullet")).toHaveCount(1);
});

test("人员菜单进入统一列表页，并按类型展示固定双列卡片", async ({ page }) => {
  const artistTypes = [
    ["host", "主持人"],
    ["singer", "歌手"],
    ["actor", "演员"]
  ] as const;

  for (const [type, title] of artistTypes) {
    await openHome(page);
    const menu = page.getByTestId(`home-menu-${type}`).first();
    await expect(menu).toBeVisible();
    await tap(page, menu);
    const artistPage = page.getByTestId(`artist-list-page-${type}`).last();
    await expect(artistPage).toBeVisible();
    await expect(page.getByTestId("artist-list-title")).toHaveText(title);
    await expect(page.getByTestId("artist-search-input")).toBeVisible();
    await expect(page.getByTestId("artist-filter-button")).toBeVisible();
    await expect(artistPage.getByTestId("artist-bottom-nav")).toHaveCount(0);
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

test("分类页三个人员入口复用对应的列表路由", async ({ page }) => {
  const artistTypes = [
    ["host", "主持人"],
    ["singer", "歌手"],
    ["actor", "演员"]
  ] as const;

  for (const [type, title] of artistTypes) {
    await openHome(page);
    await tap(page, page.getByText("分类").last());
    await expect(page.getByTestId("category-page")).toBeVisible();
    await tap(page, page.getByTestId(`category-artist-${type}`));
    await expect(page.getByTestId(`artist-list-page-${type}`)).toBeVisible();
    await expect(page.getByTestId("artist-list-title")).toHaveText(title);
  }
});

test("人员页作为子页面不渲染底部菜单", async ({ page }) => {
  for (const type of ["host", "singer", "actor"] as const) {
    await openHome(page);
    await tap(page, page.getByTestId(`home-menu-${type}`).first());
    const artistPage = page.getByTestId(`artist-list-page-${type}`).last();
    await expect(artistPage).toBeVisible();
    await expect(artistPage.getByTestId("artist-bottom-nav")).toHaveCount(0);
  }
});

test("人员页卡片、搜索、筛选和详情交互可用", async ({ page }) => {
  await openHome(page);
  await tap(page, page.getByTestId("home-menu-host").first());

  const cards = page.getByTestId("artist-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(6);
  const dimensions = await cards.evaluateAll((nodes) =>
    nodes.slice(0, 2).map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })
  );
  expect(dimensions[0].width).toBeCloseTo(dimensions[1].width, 1);
  expect(dimensions[0].height).toBeCloseTo(dimensions[1].height, 1);

  const searchInput = page.getByTestId("artist-search-input").locator("input");
  await searchInput.fill("林然");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("林然");

  await searchInput.fill("");
  await expect(cards).toHaveCount(6);
  await tap(page, page.getByTestId("artist-filter-button"));
  await expect(page.getByTestId("artist-filter-panel")).toBeVisible();
  await tap(page, page.getByTestId("artist-filter-location-杭州"));
  await tap(page, page.getByTestId("artist-filter-confirm"));
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("杭州");

  await tap(page, cards.first());
  await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
});

test("人员 BANNER 富文本详情使用公共 hero、轮播和覆盖布局", async ({ page, request }) => {
  const { artistBanner } = await resolveDetailFixtures(request);
  await openDetail(page, artistBanner.detailPageId);
  await waitForDetailVisuals(page);
  await expectBannerDetail(page, artistBanner.name, "主持人");
  await expect(page.getByTestId("detail-banner-image")).toHaveCount(3);
  await expect(page.getByTestId("detail-hero")).toContainText("温暖・专业・掌控全场");
  await expect(page.getByTestId("detail-hero")).toContainText("金牌主持");
  await expect(page.getByTestId("detail-hero")).toContainText("10年经验");
  await expect(page.getByTestId("detail-hero")).toContainText("杭州");
  await expect(
    page.getByTestId("detail-rich-text-block").first().locator("img").first()
  ).toBeVisible();
  await expectCommonDetailQuality(page);
  await expectDetailBackFallback(page, "miniapp-home");
});

test("人员单富文本详情完全移除 BANNER DOM、占高和负重叠", async ({ page, request }) => {
  const { artistRich } = await resolveDetailFixtures(request);
  await openDetail(page, artistRich.detailPageId);
  await waitForDetailVisuals(page);
  await expectRichOnlyDetail(page, artistRich.name);
  await expectCommonDetailQuality(page);
  await expectDetailBackFallback(page, "miniapp-home");
});

test("案例 BANNER 富文本详情显示案例元数据并用独立 Video 节点", async ({ page, request }) => {
  const { caseBanner } = await resolveDetailFixtures(request);
  await openDetail(page, caseBanner.detailPageId);
  await waitForDetailVisuals(page);
  await expectBannerDetail(page, caseBanner.title, "婚礼主持");
  await expect(page.getByTestId("detail-hero")).toContainText("杭州・西湖区");
  await expect(page.getByTestId("detail-hero")).toContainText("日期：2024-05-18");
  const video = page.getByTestId("detail-video").locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).not.toHaveAttribute("autoplay");
  await expect(video).not.toHaveAttribute("loop");
  await expect(page.getByTestId("detail-rich-text-block").locator("video")).toHaveCount(0);
  await expectCommonDetailQuality(page);
  await expectDetailBackFallback(page, "miniapp-home");
});

test("案例单富文本详情从导航后正常起始且没有轮播残留", async ({ page, request }) => {
  const { caseRich } = await resolveDetailFixtures(request);
  await openDetail(page, caseRich.detailPageId);
  await waitForDetailVisuals(page);
  await expectRichOnlyDetail(page, caseRich.title);
  await expect(
    page.getByTestId("detail-rich-text-block").first().locator("img").first()
  ).toBeVisible();
  await expectCommonDetailQuality(page);
  await expectDetailBackFallback(page, "miniapp-home");
});

test("详情路由切换 ID 不显示上一条数据", async ({ page, request }) => {
  const { artistBanner, artistRich } = await resolveDetailFixtures(request);
  await page.route(`**/api/client/detail-pages/${artistBanner.detailPageId}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  await openDetail(page, artistBanner.detailPageId);
  await page.goto(detailRoute(artistRich.detailPageId));
  await expect(page.getByTestId("detail-layout-rich-only")).toBeVisible();
  await expect(page.getByTestId("detail-navigation")).toContainText(artistRich.name);
  await expect(page.getByText(artistBanner.name)).toHaveCount(0);
  await expect(page.getByTestId("detail-banner")).toHaveCount(0);
});

test("详情接口错误展示重试并可恢复", async ({ page, request }) => {
  const { artistRich } = await resolveDetailFixtures(request);
  let failed = false;
  await page.route(`**/api/client/detail-pages/${artistRich.detailPageId}`, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "E2E_DETAIL_FAIL", message: "E2E 详情失败" }
        })
      });
      return;
    }
    await route.continue();
  });
  await openDetail(page, artistRich.detailPageId);
  await expect(page.getByTestId("detail-state-error")).toBeVisible();
  await expect(page.getByText("页面加载失败")).toBeVisible();
  await tap(page, page.getByTestId("detail-retry"));
  await expect(page.getByTestId("detail-layout-rich-only")).toBeVisible();
  await expect(page.getByTestId("detail-navigation")).toContainText(artistRich.name);
});

test("四种详情页视觉截图与人员详情对齐差异图", async ({ page, request }) => {
  const fixtures = await resolveDetailFixtures(request);
  const captures = [
    [fixtures.artistBanner.detailPageId, "actual-artist-banner-rich-text.png"],
    [fixtures.artistRich.detailPageId, "actual-artist-rich-text.png"],
    [fixtures.caseBanner.detailPageId, "actual-case-banner-rich-text.png"],
    [fixtures.caseRich.detailPageId, "actual-case-rich-text.png"]
  ] as const;
  for (const [id, filename] of captures) {
    await openDetail(page, id);
    await waitForDetailVisuals(page);
    await page.screenshot({
      path: `docs/design/${filename}`,
      fullPage: true,
      animations: "disabled"
    });
  }
  await createDetailComparison("docs/design/actual-artist-banner-rich-text.png");
});

test("分类页的人员入口复用同一类型化列表", async ({ page }) => {
  await openHome(page);
  await tap(page, page.getByText("分类").last());
  await expect(page.getByTestId("category-page")).toBeVisible();
  await tap(page, page.getByTestId("category-artist-singer"));
  await expect(page.getByTestId("artist-list-page-singer")).toBeVisible();
  await expect(page.getByTestId("artist-list-title")).toHaveText("歌手");
});

test("人员列表设计复核截图与参考差异图", async ({ page, request }) => {
  await prepareDesignReviewData(request);
  async function capture(type: "host" | "singer" | "actor", filename: string) {
    await openHome(page);
    await tap(page, page.getByTestId(`home-menu-${type}`).first());
    const artistPage = page.getByTestId(`artist-list-page-${type}`).last();
    await expect(artistPage).toBeVisible();
    await expect(page.getByTestId("artist-card").first()).toBeVisible();
    await expect(artistPage.locator("img").last()).toBeVisible();
    await page.waitForTimeout(400);
    await artistPage.screenshot({ path: `docs/design/${filename}` });
  }

  await capture("host", "actual-artists-host.png");
  await capture("singer", "actual-artists-singer.png");
  await capture("actor", "actual-artists-actor.png");

  const hostPath = "docs/design/actual-artists-host.png";
  const host = await sharp(hostPath).metadata();
  if (!host.width || !host.height) throw new Error("人员列表 host 截图尺寸无效");
  const reference = await sharp("docs/design/reference-artists.png")
    .resize(host.width, host.height, { fit: "fill" })
    .png()
    .toBuffer();
  await sharp(reference)
    .composite([{ input: hostPath, blend: "difference" }])
    .png()
    .toFile("docs/design/diff-artists-host.png");
});

test("精选案例展示并可进入详情页", async ({ page }) => {
  await openHome(page);
  await expect(
    page.locator(".section-heading__title").filter({ hasText: "精选案例" })
  ).toBeVisible();
  await expect(page.getByTestId("home-featured-cases")).toBeVisible();
  await expect(page.getByTestId("home-case-card").first()).toBeVisible();
  await tap(page, page.getByTestId("home-case-card").first());
  await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
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
  await expect(page.getByTestId("home-banner-image").first()).toHaveAttribute(
    "data-current-src",
    home.site.placeholderBannerUrl
  );
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
