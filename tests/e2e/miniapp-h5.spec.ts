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
type Menu = { id: number; text: string; iconAssetId: number; type: string; status: string; showOnHome: boolean; configJson?: Record<string, unknown> };
type CaseItem = { id: number; title: string; status: string; isFeatured: boolean };
type ArticleItem = { id: number; title: string; category: string; detailPageId: number | null; hasDetailPage: boolean };
type ArticleListResponse = { items: ArticleItem[]; categories: string[]; total: number; page: number; pageSize: number };
type ArtistListItem = { id: number; name: string; type: string; location: string; detailPageId: number | null };
type CaseListItem = { id: number; title: string; detailPageId: number | null };
type LinkedArtistListItem = ArtistListItem & { detailPageId: number };
type LinkedCaseListItem = CaseListItem & { detailPageId: number };
type DetailPageDto = {
  id: number;
  name: string;
  typeLabel: string;
  rendererKey: string;
  hero: {
    title: string;
    typeLabel: string;
    subtitle: string;
    badge: string;
    tags: string[];
    location: string;
    metaItems: Array<{ label: string; value: string }>;
  };
  banners: Array<{ id: number; url: string; sortOrder: number }>;
  blocks: Array<{ type: "richText"; html: string } | { type: "video"; url: string; width: number | null; height: number | null }>;
  cards: Array<{
    blocks: Array<{ type: "richText"; html: string } | { type: "video"; url: string; width: number | null; height: number | null }>;
  }>;
};
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
  banners: Array<{ id: number; imageUrl: string }>;
  featuredArticles: ArticleItem[];
};

const longActivityCaseHero = {
  title: "浪漫粉色系户外婚礼暨品牌答谢晚宴",
  typeLabel: "企业品牌活动统筹与婚礼主持",
  subtitle: "专业策划・精彩呈现・全流程现场执行",
  badge: "品牌婚礼案例",
  tags: ["户外草坪", "浪漫仪式", "品牌答谢", "现场统筹"],
  location: "杭州・西湖区",
  metaItems: [{ label: "日期", value: "2024-05-18" }]
} satisfies DetailPageDto["hero"];

test.describe.configure({ mode: "serial" });

function assetUrl(url: string) {
  return new URL(url, apiBase).href;
}

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
  detailPageId: number | null = null,
  content = `${summary} 内容`
) {
  return adminApi<Announcement>(request, "POST", "/api/admin/announcements", {
    summary,
    content,
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

async function pullDownRefresh(page: Page) {
  await clearDevOverlay(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const client = await page.context().newCDPSession(page);
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const x = viewport.width / 2;
  const startY = 72;
  const endY = Math.min(viewport.height - 96, 360);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: startY }]
  });
  for (let step = 1; step <= 8; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY + ((endY - startY) * step) / 8 }]
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

async function resolveDetailFixtures(request: APIRequestContext): Promise<DetailFixtures> {
  const artists = await clientApi<ArtistListItem[]>(request, `/api/client/artists?category=${encodeURIComponent("主持人")}`);
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

async function expectDetailPageDtoContract(page: Page, dto: DetailPageDto) {
  const expectedHeroTitle = dto.hero.title.trim() || dto.name.trim();
  const expectedTypeLabel = dto.hero.typeLabel.trim() || dto.typeLabel.trim();
  await expect(page.getByTestId("detail-hero")).toContainText(expectedHeroTitle);
  await expect(page.getByTestId("detail-hero")).toContainText(expectedTypeLabel);
  if (dto.hero.subtitle.trim()) {
    await expect(page.getByTestId("detail-hero")).toContainText(dto.hero.subtitle.trim());
  }
  const expectedTags = dto.hero.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 4);
  const heroTags = page.getByTestId("detail-hero-tag");
  await expect(heroTags).toHaveCount(expectedTags.length);
  for (const [index, tag] of expectedTags.entries()) {
    await expect(heroTags.nth(index)).toHaveText(tag);
    await expect(heroTags.nth(index)).toBeVisible();
  }
  const expectedMetaItems = dto.hero.metaItems.filter((item) => item.value.trim());
  const heroMetaItems = page.getByTestId("detail-hero-meta-item");
  await expect(heroMetaItems).toHaveCount(expectedMetaItems.length);
  for (const [index, item] of expectedMetaItems.entries()) {
    await expect(heroMetaItems.nth(index)).toHaveText(`${item.label}：${item.value}`);
    await expect(heroMetaItems.nth(index)).toBeVisible();
  }
  if (dto.hero.location.trim()) {
    await expect(page.getByTestId("detail-hero-location")).toHaveText(dto.hero.location.trim());
    await expect(page.getByTestId("detail-hero-location")).toBeVisible();
  }

  const expectedBannerUrls = [...dto.banners]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    .map((banner) => assetUrl(banner.url));
  const renderedBannerUrls = await page.getByTestId("detail-banner-image").evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).getAttribute("data-current-src") || "")
  );
  expect(renderedBannerUrls.map(assetUrl)).toEqual(expectedBannerUrls);

  const renderedCards = await page.getByTestId("detail-rich-content").evaluate((root) =>
    Array.from(root.querySelectorAll('[data-testid="detail-rich-card"]')).map((card) =>
      Array.from(card.children)
        .filter(
          (child) =>
            child.getAttribute("data-testid") === "detail-rich-text-block" ||
            child.getAttribute("data-testid") === "detail-video"
        )
        .map((child) => child.getAttribute("data-testid") === "detail-video" ? "video" : "richText")
    )
  );
  const expectedCards = dto.cards.length > 0 ? dto.cards : [{ blocks: dto.blocks }];
  expect(renderedCards).toEqual(
    expectedCards.map((card) => card.blocks.map((block) => block.type))
  );

  const richTextPresentation = await page.getByTestId("detail-rich-content").evaluate((root) => ({
    expectedHeadingFontSize: 17,
    headings: Array.from(root.querySelectorAll('[data-detail-heading="true"]')).map((heading) => {
      const marker = heading.querySelector<HTMLElement>("[data-detail-heading-marker='true']");
      const content = heading.querySelector<HTMLElement>("[data-detail-heading-content='true']");
      const markerRect = marker?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const style = getComputedStyle(heading);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        display: style.display,
        alignItems: style.alignItems,
        markerHeight: markerRect?.height ?? 0,
        markerContentCenterDelta: markerRect && contentRect
          ? Math.abs((markerRect.top + markerRect.bottom - contentRect.top - contentRect.bottom) / 2)
          : -1,
        markerInlineHeight: marker?.style.height ?? "",
        markerInlineMaxHeight: marker?.style.maxHeight ?? ""
      };
    }),
    images: Array.from(root.querySelectorAll("img")).map((image) => ({
      width: image.getBoundingClientRect().width,
      containerWidth: image.parentElement?.getBoundingClientRect().width ?? 0,
      attributeWidth: image.getAttribute("width") ?? "",
      attributeHeight: image.getAttribute("height") ?? "",
      inlineWidth: image.style.width,
      inlineMaxWidth: image.style.maxWidth,
      inlineHeight: image.style.height
    }))
  }));
  expect(richTextPresentation.headings.length).toBeGreaterThan(0);
  richTextPresentation.headings.forEach((heading) => {
    expect(heading.fontSize).toBeCloseTo(richTextPresentation.expectedHeadingFontSize, 1);
    expect(heading.display).toBe("flex");
    expect(heading.alignItems).toBe("center");
    expect(heading.markerHeight).toBeGreaterThan(0);
    expect(heading.markerHeight).toBeLessThanOrEqual(heading.fontSize + 0.5);
    expect(heading.markerContentCenterDelta).toBeGreaterThanOrEqual(0);
    expect(heading.markerContentCenterDelta).toBeLessThanOrEqual(1);
    expect(heading.markerInlineHeight).toBe("13px");
    expect(heading.markerInlineMaxHeight).toBe("13px");
  });
  richTextPresentation.images.forEach((image) => {
    const trustedWidth = /^\d+(?:\.\d+)?$/.test(image.attributeWidth) && /^\d+(?:\.\d+)?$/.test(image.attributeHeight)
      ? Number(image.attributeWidth)
      : null;
    expect(image.width).toBeLessThanOrEqual(image.containerWidth + 1);
    expect(image.inlineWidth).toBe(trustedWidth ? `${trustedWidth}px` : "100%");
    expect(image.inlineMaxWidth).toBe("100%");
    expect(image.inlineHeight).toBe("auto");
    if (trustedWidth && trustedWidth < image.containerWidth) {
      expect(image.width).toBeCloseTo(trustedWidth, 1);
    }
  });

  const geometry = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="detail-banner"]')!.getBoundingClientRect();
    const content = document.querySelector('[data-testid="detail-content-overlap"]')!.getBoundingClientRect();
    return {
      bannerHeight: banner.height,
      minimumBannerHeight: banner.width * 424 / 750,
      overlap: banner.bottom - content.top
    };
  });
  expect(geometry.bannerHeight).toBeGreaterThanOrEqual(geometry.minimumBannerHeight - 1);
  expect(geometry.overlap).toBeGreaterThanOrEqual(18);
  expect(geometry.overlap).toBeLessThanOrEqual(28);
}

async function expectCommonDetailQuality(page: Page) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  await expect(page.getByTestId("detail-floating-share")).toHaveCount(0);
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
    const firstCard = document.querySelector(".detail-rich-card")!.getBoundingClientRect();
    return {
      amount: banner.bottom - content.top,
      bannerHeight: banner.height,
      minimumBannerHeight: banner.width * 424 / 750,
      firstCardVisible: firstCard.top >= content.top - 1
    };
  });
  expect(overlap.bannerHeight).toBeGreaterThanOrEqual(overlap.minimumBannerHeight - 1);
  expect(overlap.amount).toBeGreaterThanOrEqual(18);
  expect(overlap.amount).toBeLessThanOrEqual(28);
  expect(overlap.firstCardVisible).toBeTruthy();
}

async function expectBannerHeroGeometry(page: Page, ownerLabel: "人员" | "活动案例") {
  const geometry = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="detail-banner"]')!.getBoundingClientRect();
    const navigation = document
      .querySelector('[data-testid="detail-navigation"]')!
      .getBoundingClientRect();
    const heading = document
      .querySelector('[data-testid="detail-hero-heading"]')!
      .getBoundingClientRect();
    const hero = document.querySelector('[data-testid="detail-hero"]')!.getBoundingClientRect();
    const firstCard = document.querySelector(".detail-rich-card")!.getBoundingClientRect();
    return {
      headingClearance: heading.top - navigation.bottom,
      heroInsideBanner: hero.bottom <= banner.bottom,
      heroCardClearance: firstCard.top - hero.bottom
    };
  });
  expect(geometry.headingClearance, `${ownerLabel} Hero 首行应保留导航安全间距`).toBeGreaterThanOrEqual(7);
  expect(geometry.heroInsideBanner, `${ownerLabel} Hero 应完整保留在 BANNER 内`).toBeTruthy();
  expect(geometry.heroCardClearance, `${ownerLabel} Hero 底部应与首卡保持可见间距`).toBeGreaterThanOrEqual(8);
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

  expect(firstCaseHeight).toBeLessThanOrEqual(205);
});

test("首页精选内容为空时卡片不产生横向滚动", async ({ page }) => {
  await page.route(`${apiBase}/api/client/home`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      data: Record<string, unknown>;
    };

    await route.fulfill({
      response,
      json: {
        ...body,
        data: {
          ...body.data,
          featuredCases: [],
          featuredArticles: []
        }
      }
    });
  });

  await openHome(page);
  await expect(page.getByText("暂无精选案例")).toBeVisible();
  await expect(page.getByText("暂无精选文章")).toBeVisible();

  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    emptyCards: Array.from(document.querySelectorAll(".case-empty")).map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })
  }));

  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.emptyCards).toHaveLength(2);
  for (const card of metrics.emptyCards) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(metrics.viewportWidth);
  }
});

test("首页精选标题与更多入口样式统一", async ({ page }) => {
  await openHome(page);
  const metrics = await page.evaluate(() => {
    const heading = (text: string) => {
      const title = Array.from(document.querySelectorAll(".section-heading__title"))
        .find((node) => node.textContent?.trim() === text);
      if (!title) throw new Error(`Missing heading ${text}`);
      const section = title.closest(".section-heading");
      const more = section?.querySelector(".section-heading__more");
      if (!section || !more) throw new Error(`Missing heading action ${text}`);
      const before = window.getComputedStyle(section, "::before");
      const moreStyle = window.getComputedStyle(more);
      return {
        beforeBackground: before.backgroundColor,
        beforeHeight: before.height,
        beforeWidth: before.width,
        moreColor: moreStyle.color,
        moreFontSize: moreStyle.fontSize,
        moreLineHeight: moreStyle.lineHeight,
        moreText: more.textContent?.trim()
      };
    };
    return {
      cases: heading("精选案例"),
      articles: heading("精选文章")
    };
  });

  expect(metrics.cases.beforeBackground).toBe(metrics.articles.beforeBackground);
  expect(metrics.cases.beforeHeight).toBe(metrics.articles.beforeHeight);
  expect(metrics.cases.beforeWidth).toBe(metrics.articles.beforeWidth);
  expect(metrics.cases.moreColor).toBe(metrics.articles.moreColor);
  expect(metrics.cases.moreFontSize).toBe(metrics.articles.moreFontSize);
  expect(metrics.cases.moreLineHeight).toBe(metrics.articles.moreLineHeight);
  expect(metrics.cases.moreText).toBe("更多案例 ›");
  expect(metrics.articles.moreText).toBe("更多文章 ›");
});

test("首页精选案例字段完整且日期地点靠近按钮底部对齐", async ({ page }) => {
  await openHome(page);
  const metrics = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="home-case-card"]'));
    if (!cards.length) throw new Error("Missing home case cards");

    const parseLineHeight = (node: Element) => {
      const lineHeight = window.getComputedStyle(node).lineHeight;
      const parsed = Number.parseFloat(lineHeight);
      if (!Number.isFinite(parsed)) throw new Error(`Invalid line-height ${lineHeight}`);
      return parsed;
    };
    const spread = (values: number[]) => (values.length > 1 ? Math.max(...values) - Math.min(...values) : 0);

    const rows = cards.map((card) => {
      const image = card.querySelector('[data-testid="home-case-image"]');
      const title = card.querySelector(".case-card__title");
      const summary = card.querySelector(".case-card__summary");
      const metaRow = card.querySelector(".case-card__meta-row");
      const dateGroup = card.querySelector(".case-card__meta-group--date");
      const locationGroup = card.querySelector(".case-card__meta-group--location");
      const dateIcon = card.querySelector('[data-testid="home-case-date-icon"]');
      const locationIcon = card.querySelector('[data-testid="home-case-location-icon"]');
      const date = card.querySelector(".case-card__meta-date");
      const location = card.querySelector(".case-card__meta-location");
      const button = card.querySelector(".case-card__button");
      if (
        !image ||
        !title ||
        !summary ||
        !metaRow ||
        !dateGroup ||
        !locationGroup ||
        !dateIcon ||
        !locationIcon ||
        !date ||
        !location ||
        !button
      ) {
        throw new Error("Missing case card layout nodes");
      }

      const cardRect = card.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const summaryRect = summary.getBoundingClientRect();
      const metaRect = metaRow.getBoundingClientRect();
      const dateGroupRect = dateGroup.getBoundingClientRect();
      const locationGroupRect = locationGroup.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
      const metaMarginTop = Number.parseFloat(window.getComputedStyle(metaRow).marginTop);

      return {
        cardHeight: cardRect.height,
        imageHeight: image.getBoundingClientRect().height,
        dateIconHeight: dateIcon.getBoundingClientRect().height,
        locationIconHeight: locationIcon.getBoundingClientRect().height,
        titleText: title.textContent?.trim() ?? "",
        summaryText: summary.textContent?.trim() ?? "",
        metaText: metaRow.textContent?.trim() ?? "",
        dateText: date.textContent?.trim() ?? "",
        locationText: location.textContent?.trim() ?? "",
        buttonText: button.textContent?.trim() ?? "",
        buttonVisibility: window.getComputedStyle(button).visibility,
        titleHeight: titleRect.height,
        titleLineHeight: parseLineHeight(title),
        summaryHeight: summaryRect.height,
        summaryLineHeight: parseLineHeight(summary),
        titleTop: titleRect.top,
        summaryTop: summaryRect.top,
        metaTop: metaRect.top,
        metaHeight: metaRect.height,
        summaryMetaGapRem: metaMarginTop / rootFontSize,
        summaryMetaVisualGap: metaRect.top - summaryRect.bottom,
        dateLeftOffset: dateGroupRect.left - metaRect.left,
        locationRightOffset: metaRect.right - locationGroupRect.right,
        dateLocationGap: locationGroupRect.left - dateGroupRect.right,
        buttonTop: buttonRect.top,
        metaButtonGap: buttonRect.top - metaRect.bottom,
        buttonBottomOffset: cardRect.bottom - buttonRect.bottom
      };
    });

    return {
      fieldCompleteness: rows.every(
        (row) =>
          row.imageHeight > 0 &&
          row.dateIconHeight > 0 &&
          row.locationIconHeight > 0 &&
          row.titleText.length > 0 &&
          row.summaryText.length > 0 &&
          !row.metaText.includes("|") &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.dateText) &&
          row.locationText.length > 0 &&
          row.buttonText === "查看详情 ›" &&
          row.buttonVisibility !== "hidden"
      ),
      locationTexts: rows.map((row) => row.locationText),
      cardHeightSpread: spread(rows.map((row) => row.cardHeight)),
      maxTitleHeight: Math.max(...rows.map((row) => row.titleHeight)),
      titleLineHeight: rows[0].titleLineHeight,
      maxSummaryHeight: Math.max(...rows.map((row) => row.summaryHeight)),
      summaryLineHeight: rows[0].summaryLineHeight,
      titleTopSpread: spread(rows.map((row) => row.titleTop)),
      summaryTopSpread: spread(rows.map((row) => row.summaryTop)),
      metaTopSpread: spread(rows.map((row) => row.metaTop)),
      metaHeightSpread: spread(rows.map((row) => row.metaHeight)),
      summaryMetaGapRemSpread: spread(rows.map((row) => row.summaryMetaGapRem)),
      minSummaryMetaGapRem: Math.min(...rows.map((row) => row.summaryMetaGapRem)),
      maxSummaryMetaGapRem: Math.max(...rows.map((row) => row.summaryMetaGapRem)),
      minSummaryMetaVisualGap: Math.min(...rows.map((row) => row.summaryMetaVisualGap)),
      maxDateLeftOffset: Math.max(...rows.map((row) => Math.abs(row.dateLeftOffset))),
      maxLocationRightOffset: Math.max(...rows.map((row) => Math.abs(row.locationRightOffset))),
      minDateLocationGap: Math.min(...rows.map((row) => row.dateLocationGap)),
      buttonTopSpread: spread(rows.map((row) => row.buttonTop)),
      maxMetaButtonGap: Math.max(...rows.map((row) => row.metaButtonGap)),
      minMetaButtonGap: Math.min(...rows.map((row) => row.metaButtonGap)),
      buttonBottomOffsetSpread: spread(rows.map((row) => row.buttonBottomOffset))
    };
  });

  expect(metrics.fieldCompleteness).toBeTruthy();
  expect(metrics.locationTexts.slice(0, 3)).toEqual(["杭州", "上海", "宁波"]);
  expect(metrics.locationTexts.every((text) => !/[・·｜|,，\s/／-]/.test(text))).toBeTruthy();
  expect(metrics.cardHeightSpread).toBeLessThanOrEqual(1);
  expect(metrics.maxTitleHeight).toBeLessThanOrEqual(metrics.titleLineHeight + 1);
  expect(metrics.maxSummaryHeight).toBeLessThanOrEqual(metrics.summaryLineHeight * 2 + 1);
  expect(metrics.titleTopSpread).toBeLessThanOrEqual(1);
  expect(metrics.summaryTopSpread).toBeLessThanOrEqual(1);
  expect(metrics.metaTopSpread).toBeLessThanOrEqual(1);
  expect(metrics.metaHeightSpread).toBeLessThanOrEqual(1);
  expect(metrics.summaryMetaGapRemSpread).toBeLessThanOrEqual(0.01);
  expect(metrics.minSummaryMetaGapRem).toBeGreaterThanOrEqual(0.59);
  expect(metrics.maxSummaryMetaGapRem).toBeLessThanOrEqual(0.61);
  expect(metrics.minSummaryMetaVisualGap).toBeGreaterThan(0);
  expect(metrics.maxDateLeftOffset).toBeLessThanOrEqual(1);
  expect(metrics.maxLocationRightOffset).toBeLessThanOrEqual(1);
  expect(metrics.minDateLocationGap).toBeGreaterThanOrEqual(0);
  expect(metrics.buttonTopSpread).toBeLessThanOrEqual(1);
  expect(metrics.minMetaButtonGap).toBeGreaterThanOrEqual(0);
  expect(metrics.maxMetaButtonGap).toBeLessThanOrEqual(8);
  expect(metrics.buttonBottomOffsetSpread).toBeLessThanOrEqual(1);
});

test("无公告时公告栏隐藏", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toHaveCount(0);
});

test("首次进入无需手势即可持续自动循环切换多条公告", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await createAnnouncement(request, "E2E 第一条公告", 100, 700);
  await createAnnouncement(request, "E2E 第二条公告", 101, 700);
  await openHome(page);
  await expect(page.getByTestId("home-announcement")).toBeVisible();
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "0");
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "1", { timeout: 2500 });
  await expect(page.getByTestId("home-announcement")).toHaveAttribute("data-current-index", "0", { timeout: 2500 });
});

test("长公告先横向滚动完整后再切换下一条", async ({ page, request }) => {
  await setAnnouncementStatus(request, "disabled");
  await createAnnouncement(
    request,
    "E2E 长公告",
    650,
    300,
    null,
    "公告内容需要完整滚动展示婚礼主持商演档期更新和咨询须知"
  );
  await createAnnouncement(request, "E2E 长公告之后", 651, 300);
  await openHome(page);

  const announcement = page.getByTestId("home-announcement");
  const alignment = await page.evaluate(() => {
    const summary = document.querySelector(".notice__summary");
    const content = document.querySelector(".notice__content");
    if (!summary || !content) throw new Error("公告文本节点缺失");
    const summaryRect = summary.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      contentCenterY: contentRect.top + contentRect.height / 2,
      summaryCenterY: summaryRect.top + summaryRect.height / 2,
      summaryLeft: summaryRect.left
    };
  });
  expect(Math.abs(alignment.summaryCenterY - alignment.contentCenterY)).toBeLessThan(1);
  await expect(announcement).toHaveAttribute("data-current-index", "0");
  await page.waitForTimeout(900);
  const summaryLeftAfterScrollStart = await page.locator(".notice__summary").first().evaluate((node) => node.getBoundingClientRect().left);
  expect(Math.abs(summaryLeftAfterScrollStart - alignment.summaryLeft)).toBeLessThan(1);
  await expect(announcement).toHaveAttribute("data-current-index", "0");
  await expect(announcement).toHaveAttribute("data-current-index", "1", { timeout: 12_000 });
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

test("人员菜单进入统一列表页，未配置分类时展示全部人员", async ({ page, request }) => {
  const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
  const expectedArtists = await clientApi<ArtistListItem[]>(request, "/api/client/artists");
  const artistMenu = menus.items.find((item) => item.type === "artist");
  if (!artistMenu) throw new Error("人员菜单种子数据缺失");

  try {
    await adminApi(request, "PUT", `/api/admin/menu-items/${artistMenu.id}`, {
      configJson: {},
      status: "enabled",
      showOnHome: true
    });

    await openHome(page);
    const menu = page.getByTestId("home-menu-artist").first();
    await expect(menu).toBeVisible();
    await tap(page, menu);
    const artistPage = page.getByTestId("artist-list-page").last();
    await expect(artistPage).toBeVisible();
    await expect(artistPage).toHaveAttribute("data-artist-category", "all");
    await expect(page.getByTestId("artist-list-title")).toHaveText("人员");
    await expect(page.getByTestId("artist-search-input")).toBeVisible();
    await expect(page.getByTestId("artist-filter-button")).toBeVisible();
    await expect(page.getByTestId("artist-card")).toHaveCount(expectedArtists.length);
    await expect(artistPage.getByTestId("artist-bottom-nav")).toHaveCount(0);
  } finally {
    await adminApi(request, "PUT", `/api/admin/menu-items/${artistMenu.id}`, {
      configJson: artistMenu.configJson ?? {},
      status: artistMenu.status,
      showOnHome: artistMenu.showOnHome
    });
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

test("人员菜单配置任意中文分类后筛选对应列表", async ({ page, request }) => {
  const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
  const expectedArtists = await clientApi<ArtistListItem[]>(request, `/api/client/artists?category=${encodeURIComponent("歌手")}`);
  const artistMenu = menus.items.find((item) => item.type === "artist");
  if (!artistMenu) throw new Error("人员菜单种子数据缺失");

  try {
    await adminApi(request, "PUT", `/api/admin/menu-items/${artistMenu.id}`, {
      configJson: { ...(artistMenu.configJson ?? {}), category: "歌手" },
      status: "enabled",
      showOnHome: true
    });

    await openHome(page);
    await tap(page, page.getByTestId("home-menu-artist").first());
    const artistPage = page.getByTestId("artist-list-page").last();
    await expect(artistPage).toBeVisible();
    await expect(artistPage).toHaveAttribute("data-artist-category", "歌手");
    await expect(page.getByTestId("artist-list-title")).toHaveText("歌手");
    await expect(page.getByTestId("artist-card")).toHaveCount(expectedArtists.length);
    await expect(page.locator(".artist-card__type").first()).toHaveText("歌手");
  } finally {
    await adminApi(request, "PUT", `/api/admin/menu-items/${artistMenu.id}`, {
      configJson: artistMenu.configJson ?? {},
      status: artistMenu.status,
      showOnHome: artistMenu.showOnHome
    });
  }
});

test("旧人员类型深链兼容到分类筛选列表", async ({ page, request }) => {
  const expectedArtists = await clientApi<ArtistListItem[]>(request, `/api/client/artists?category=${encodeURIComponent("主持人")}`);
  await page.goto("/#/pages/artists/list?type=host");
  const artistPage = page.getByTestId("artist-list-page").last();
  await expect(artistPage).toBeVisible();
  await expect(artistPage).toHaveAttribute("data-artist-category", "主持人");
  await expect(page.getByTestId("artist-list-title")).toHaveText("主持人");
  await expect(page.getByTestId("artist-card")).toHaveCount(expectedArtists.length);
});

test("分类页人员入口复用同一列表路由", async ({ page }) => {
  await openHome(page);
  await tap(page, page.getByText("分类").last());
  await expect(page.getByTestId("category-page")).toBeVisible();
  await tap(page, page.getByTestId("category-artist-artist"));
  await expect(page.getByTestId("artist-list-page")).toBeVisible();
  await expect(page.getByTestId("artist-list-title")).toHaveText("人员");
});

test("分类页使用后端菜单，首页隐藏项仍在分类页展示，停用项两处隐藏", async ({ page, request }) => {
  const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
  const homeHidden = menus.items.find((item) => item.type === "artist");
  const disabled = menus.items.find((item) => item.type === "activity_case");
  if (!homeHidden || !disabled) throw new Error("菜单种子数据缺失");

  try {
    await adminApi(request, "PUT", `/api/admin/menu-items/${homeHidden.id}`, { status: "enabled", showOnHome: false });
    await adminApi(request, "PUT", `/api/admin/menu-items/${disabled.id}`, { status: "disabled" });

    await openHome(page);
    await expect(page.getByTestId(`home-menu-${homeHidden.type}`)).toHaveCount(0);
    await expect(page.getByTestId(`home-menu-${disabled.type}`)).toHaveCount(0);
    await tap(page, page.getByText("分类").last());
    await expect(page.getByTestId("category-page")).toBeVisible();
    await expect(page.getByTestId(`category-menu-${homeHidden.id}`)).toBeVisible();
    await expect(page.getByTestId(`category-artist-${homeHidden.type}`)).toBeVisible();
    await expect(page.getByTestId(`category-artist-${disabled.type}`)).toHaveCount(0);
  } finally {
    await adminApi(request, "PUT", `/api/admin/menu-items/${homeHidden.id}`, {
      status: homeHidden.status,
      showOnHome: homeHidden.showOnHome
    });
    await adminApi(request, "PUT", `/api/admin/menu-items/${disabled.id}`, {
      status: disabled.status,
      showOnHome: disabled.showOnHome
    });
  }
});

test("详情页直达菜单从首页和分类页进入同一独立详情页", async ({ page, request }) => {
  const menuText = "E2E 详情页直达";
  const detailName = "E2E H5 菜单直达详情";
  const detailBody = "E2E H5 菜单直达正文";
  const removeFixtures = async () => {
    const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
    for (const menu of menus.items.filter((item) => item.text === menuText)) {
      await adminApi(request, "DELETE", `/api/admin/menu-items/${menu.id}`);
    }
    const details = await adminApi<AdminList<{ id: number; name: string; referenceCount: number }>>(
      request,
      "GET",
      `/api/admin/detail-pages?q=${encodeURIComponent(detailName)}&pageSize=100`
    );
    for (const detail of details.items.filter((item) => item.name === detailName && item.referenceCount === 0)) {
      await adminApi(request, "DELETE", `/api/admin/detail-pages/${detail.id}`);
    }
  };

  await removeFixtures();
  try {
    const seedMenus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
    const iconSource = seedMenus.items.find((item) => Number.isInteger(item.iconAssetId));
    if (!iconSource) throw new Error("菜单图标种子数据缺失");
    const detail = await createRichTextDetailPage(request, detailName, `<p>${detailBody}</p>`);
    const menu = await adminApi<Menu>(request, "POST", "/api/admin/menu-items", {
      text: menuText,
      iconAssetId: iconSource.iconAssetId,
      type: "detail_page",
      configJson: { detailPageType: "rich_text", detailPageId: detail.id },
      showOnHome: true,
      sortOrder: 88,
      status: "enabled"
    });

    await openHome(page);
    await tap(page, page.getByTestId("home-menu-detail_page").filter({ hasText: menuText }));
    await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
    await expect(page.getByTestId("detail-rich-text-block")).toContainText(detailBody);

    await openHome(page);
    await tap(page, page.getByText("分类").last());
    await expect(page.getByTestId("category-page")).toBeVisible();
    await tap(page, page.getByTestId(`category-menu-${menu.id}`));
    await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
    await expect(page.getByTestId("detail-rich-text-block")).toContainText(detailBody);
  } finally {
    await removeFixtures();
  }
});

test("人员页作为子页面不渲染底部菜单", async ({ page }) => {
  await openHome(page);
  await tap(page, page.getByTestId("home-menu-artist").first());
  const artistPage = page.getByTestId("artist-list-page").last();
  await expect(artistPage).toBeVisible();
  await expect(artistPage.getByTestId("artist-bottom-nav")).toHaveCount(0);
});

test("人员页卡片、搜索、筛选和详情交互可用", async ({ page, request }) => {
  const expectedArtists = await clientApi<ArtistListItem[]>(request, "/api/client/artists");
  const expectedHangzhouArtists = expectedArtists.filter((item) => item.location === "杭州");
  await openHome(page);
  await tap(page, page.getByTestId("home-menu-artist").first());

  const cards = page.getByTestId("artist-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(expectedArtists.length);
  const dimensions = await cards.evaluateAll((nodes) =>
    nodes.slice(0, 2).map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })
  );
  expect(dimensions[0].width).toBeCloseTo(dimensions[1].width, 1);
  expect(dimensions[0].height).toBeCloseTo(dimensions[1].height, 1);
  await expect(cards.first().locator(".artist-card__tag")).toHaveCount(3);

  const searchInput = page.getByTestId("artist-search-input").locator("input");
  await searchInput.fill("林然");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("林然");

  await searchInput.fill("");
  await expect(cards).toHaveCount(expectedArtists.length);
  await tap(page, page.getByTestId("artist-filter-button"));
  await expect(page.getByTestId("artist-filter-panel")).toBeVisible();
  await tap(page, page.getByTestId("artist-filter-location-杭州"));
  await tap(page, page.getByTestId("artist-filter-confirm"));
  await expect(cards).toHaveCount(expectedHangzhouArtists.length);
  await expect(cards.first()).toContainText("杭州");

  await tap(page, cards.first());
  await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
});

test("案例页支持菜单分类、关键词搜索、单列卡片和详情跳转", async ({ page, request }) => {
  const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
  const caseMenu = menus.items.find((item) => item.type === "activity_case");
  if (!caseMenu) throw new Error("活动案例菜单种子数据缺失");

  try {
    await adminApi(request, "PUT", `/api/admin/menu-items/${caseMenu.id}`, {
      configJson: { ...(caseMenu.configJson ?? {}), category: "歌手演出" },
      status: "enabled",
      showOnHome: true
    });
    await openHome(page);
    await tap(page, page.getByTestId("home-menu-activity_case").first());
    await expect(page.getByTestId("case-list-page")).toBeVisible();
    await expect(page.getByTestId("case-search-input")).toBeVisible();

    await expect(page.getByTestId("case-list-card")).toHaveCount(1);
    await expect(page.getByTestId("case-list-card").first()).toContainText("企业年会歌手演出");

    const searchInput = page.getByTestId("case-search-input").locator("input");
    await searchInput.fill("浦东");
    await expect(page.getByTestId("case-list-card")).toHaveCount(1);
    await expect(page.getByTestId("case-list-card").first()).toContainText("企业年会歌手演出");
    await searchInput.fill("婚礼");
    await expect(page.getByText("没有匹配的案例")).toBeVisible();
    await searchInput.fill("");
    await expect(page.getByTestId("case-list-card")).toHaveCount(1);
    await expect(page.getByTestId("case-list-card").first().locator(".case-card__button")).toHaveCount(0);
    const cardWidth = await page.getByTestId("case-list-card").first().evaluate((node) => node.getBoundingClientRect().width);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(cardWidth).toBeGreaterThan(viewportWidth * 0.9);
    await expect(page.getByTestId("case-list-meta").first()).toBeVisible();

    await tap(page, page.getByTestId("case-list-card").first());
    await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
  } finally {
    await adminApi(request, "PUT", `/api/admin/menu-items/${caseMenu.id}`, {
      configJson: caseMenu.configJson ?? {},
      status: caseMenu.status,
      showOnHome: caseMenu.showOnHome
    });
  }
});

test("人员 BANNER 富文本详情使用公共 hero、轮播和覆盖布局", async ({ page, request }) => {
  const { artistBanner } = await resolveDetailFixtures(request);
  const dto = await clientApi<DetailPageDto>(request, `/api/client/detail-pages/${artistBanner.detailPageId}`);
  await openDetail(page, artistBanner.detailPageId);
  await waitForDetailVisuals(page);
  await expectBannerDetail(page, artistBanner.name, "主持人");
  await expectBannerHeroGeometry(page, "人员");
  await expectDetailPageDtoContract(page, dto);
  await expect(page.getByTestId("detail-banner-image")).toHaveCount(3);
  await expect(page.getByTestId("detail-hero")).toContainText("温暖・专业・掌控全场");
  await expect(page.getByTestId("detail-hero")).toContainText("金牌主持");
  await expect(page.getByTestId("detail-hero")).toContainText("10年经验");
  await expect(page.getByTestId("detail-hero")).toContainText("杭州");
  await expect(
    page.getByTestId("detail-rich-content").locator("img").first()
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
  const dto = await clientApi<DetailPageDto>(request, `/api/client/detail-pages/${caseBanner.detailPageId}`);
  const longDto: DetailPageDto = { ...dto, hero: longActivityCaseHero };
  await page.route(`**/api/client/detail-pages/${caseBanner.detailPageId}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { success: boolean; data: DetailPageDto };
    await route.fulfill({ response, json: { ...body, data: longDto } });
  });
  await openDetail(page, caseBanner.detailPageId);
  await waitForDetailVisuals(page);
  await expectBannerDetail(page, longActivityCaseHero.title, longActivityCaseHero.typeLabel);
  await expectBannerHeroGeometry(page, "活动案例");
  await expectDetailPageDtoContract(page, longDto);
  await expect(page.getByTestId("detail-hero")).toContainText("杭州・西湖区");
  await expect(page.getByTestId("detail-hero")).toContainText("日期：2024-05-18");
  const video = page.getByTestId("detail-video").locator("video");
  await expect(video).toHaveCount(1);
  const videoGeometry = await page.getByTestId("detail-video").evaluate((wrap) => {
    const videoElement = wrap.querySelector("video")!;
    const wrapRect = wrap.getBoundingClientRect();
    const cardRect = wrap.closest('[data-testid="detail-rich-card"]')!.getBoundingClientRect();
    return {
      wrapWidth: wrapRect.width,
      wrapHeight: wrapRect.height,
      cardWidth: cardRect.width,
      inlineMaxWidth: (wrap as HTMLElement).style.maxWidth,
      inlineAspectRatio: (wrap as HTMLElement).style.aspectRatio,
      videoWidth: videoElement.getBoundingClientRect().width,
      videoHeight: videoElement.getBoundingClientRect().height
    };
  });
  const videoBlock = longDto.cards.flatMap((card) => card.blocks).find((block) => block.type === "video");
  if (!videoBlock || videoBlock.type !== "video" || !videoBlock.width || !videoBlock.height) {
    throw new Error("详情页视频缺少可信尺寸");
  }
  expect(videoGeometry.inlineMaxWidth).toBe(`${videoBlock.width}px`);
  expect(videoGeometry.inlineAspectRatio).toBe(`${videoBlock.width} / ${videoBlock.height}`);
  expect(videoGeometry.wrapWidth).toBeLessThanOrEqual(Math.min(videoBlock.width, videoGeometry.cardWidth) + 1);
  expect(videoGeometry.videoWidth).toBeCloseTo(videoGeometry.wrapWidth, 1);
  expect(videoGeometry.videoHeight).toBeCloseTo(videoGeometry.wrapHeight, 1);
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
    page.getByTestId("detail-rich-content").locator("img").first()
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

test("详情接口错误无点击重载并可下拉刷新恢复", async ({ page, request }) => {
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
  await expect(page.getByText("请下拉刷新重试")).toBeVisible();
  await expect(page.getByTestId("detail-retry")).toHaveCount(0);
  const recovered = page.waitForResponse((response) =>
    response.url().includes(`/api/client/detail-pages/${artistRich.detailPageId}`) &&
    response.request().method() === "GET" &&
    response.ok()
  );
  await pullDownRefresh(page);
  await recovered;
  await expect(page.getByTestId("detail-layout-rich-only")).toBeVisible();
  await expect(page.getByTestId("detail-navigation")).toContainText(artistRich.name);
});

test("旧人员和案例详情错误无点击重载并可下拉刷新恢复", async ({ page, request }) => {
  const { artistBanner, caseBanner } = await resolveDetailFixtures(request);
  const scenarios = [
    {
      url: `/#/pages/artists/detail?id=${artistBanner.id}`,
      api: `/api/client/artists/${artistBanner.id}`,
      stateTestId: "artist-detail-legacy-state"
    },
    {
      url: `/#/pages/cases/detail?id=${caseBanner.id}`,
      api: `/api/client/cases/${caseBanner.id}`,
      stateTestId: "case-detail-legacy-state"
    }
  ];

  for (const scenario of scenarios) {
    let failed = false;
    await page.route(`**${scenario.api}`, async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: { code: "E2E_LEGACY_DETAIL_FAIL", message: "E2E 旧详情失败" }
          })
        });
        return;
      }
      await route.continue();
    });
    await page.goto(scenario.url);
    await expect(page.getByTestId(scenario.stateTestId)).toBeVisible();
    await expect(page.getByText("页面加载失败")).toBeVisible();
    await expect(page.getByText("请下拉刷新重试")).toBeVisible();
    await expect(page.getByTestId("detail-retry")).toHaveCount(0);
    const recovered = page.waitForResponse((response) =>
      response.url().includes(scenario.api) && response.request().method() === "GET" && response.ok()
    );
    await pullDownRefresh(page);
    await recovered;
    await expect(page.getByTestId("standalone-detail-page")).toBeVisible();
    await page.unroute(`**${scenario.api}`);
  }
});

test("详情 Banner 与视频失败只提示且无媒体点击重载", async ({ page, request }) => {
  const { artistBanner, caseBanner } = await resolveDetailFixtures(request);
  const artistDto = await clientApi<DetailPageDto>(request, `/api/client/detail-pages/${artistBanner.detailPageId}`);
  const caseDto = await clientApi<DetailPageDto>(request, `/api/client/detail-pages/${caseBanner.detailPageId}`);
  const firstBanner = artistDto.banners[0];
  const videoBlock = caseDto.blocks.find((block): block is { type: "video"; url: string } => block.type === "video");
  if (!firstBanner || !videoBlock) throw new Error("详情媒体 E2E seed 不完整");
  const bannerUrl = assetUrl(firstBanner.url);

  await page.route(bannerUrl, (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "banner unavailable" })
  );
  await openDetail(page, artistBanner.detailPageId);
  await expect(page.getByTestId("detail-banner-media-error")).toBeVisible();
  await expect(page.getByText(/BANNER 图片加载失败/u)).toBeVisible();
  await expect(page.getByText("请下拉刷新重试")).toBeVisible();
  await expect(page.getByTestId("detail-banner-media-retry")).toHaveCount(0);
  await expect(page.getByText("重新加载图片")).toHaveCount(0);

  await page.route(assetUrl(videoBlock.url), (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "video unavailable" })
  );
  await openDetail(page, caseBanner.detailPageId);
  await expect(page.getByTestId("detail-video-error")).toBeVisible();
  await expect(page.getByText("视频加载失败，请下拉刷新重试")).toBeVisible();
  await expect(page.getByText("重新加载")).toHaveCount(0);
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

test("分类页的人员入口复用同一人员列表", async ({ page }) => {
  await openHome(page);
  await tap(page, page.getByText("分类").last());
  await expect(page.getByTestId("category-page")).toBeVisible();
  await tap(page, page.getByTestId("category-artist-artist"));
  await expect(page.getByTestId("artist-list-page")).toBeVisible();
  await expect(page.getByTestId("artist-list-title")).toHaveText("人员");
});

test("人员列表设计复核截图与参考差异图", async ({ page, request }) => {
  await prepareDesignReviewData(request);
  async function capture(filename: string) {
    await openHome(page);
    await tap(page, page.getByTestId("home-menu-artist").first());
    const artistPage = page.getByTestId("artist-list-page").last();
    await expect(artistPage).toBeVisible();
    await expect(page.getByTestId("artist-card").first()).toBeVisible();
    await expect(artistPage.locator("img").last()).toBeVisible();
    await page.waitForTimeout(400);
    await artistPage.screenshot({ path: `docs/design/${filename}` });
  }

  await capture("actual-artists-host.png");

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

test("首页精选文章、文章菜单筛选、公共详情和无详情静态卡片可用", async ({ page, request }) => {
  const menus = await adminApi<AdminList<Menu>>(request, "GET", "/api/admin/menu-items");
  const articleMenu = menus.items.find((item) => item.type === "article");
  if (!articleMenu) throw new Error("文章菜单种子数据缺失");
  const allArticles = await clientApi<ArticleListResponse>(request, "/api/client/articles?pageSize=50");
  const noDetailArticle = allArticles.items.find((item) => !item.hasDetailPage);
  if (!noDetailArticle) throw new Error("文章种子数据缺少无详情页文章");

  try {
    await adminApi(request, "PUT", `/api/admin/menu-items/${articleMenu.id}`, {
      configJson: { category: "婚礼攻略", pageSize: 10 },
      status: "enabled",
      showOnHome: true
    });

    const home = await clientApi<HomeResponse>(request, "/api/client/home");
    expect(home.featuredArticles).toHaveLength(2);
    expect(home.featuredArticles.every((item) => item.hasDetailPage)).toBe(true);

    await openHome(page);
    await expect(page.getByTestId("home-featured-articles")).toBeVisible();
    await expect(page.getByTestId("home-article-card")).toHaveCount(2);
    await expect(page.getByTestId("home-article-more")).toBeVisible();
    const firstCardGeometry = await page.getByTestId("home-article-card").first().evaluate((node) => {
      const card = node.getBoundingClientRect();
      const image = node.querySelector('[data-testid="home-article-cover"]')?.getBoundingClientRect();
      const title = node.querySelector(".article-card__title")?.getBoundingClientRect();
      const summary = node.querySelector(".article-card__summary")?.getBoundingClientRect();
      const time = node.querySelector(".article-card__time-row")?.getBoundingClientRect();
      const timeIcon = node.querySelector('[data-testid="home-article-time-icon"]')?.getBoundingClientRect();
      return {
        cardWidth: card.width,
        cardHeight: card.height,
        imageWidth: image?.width ?? 0,
        imageHeight: image?.height ?? 0,
        titleHeight: title?.height ?? 0,
        summaryHeight: summary?.height ?? 0,
        timeTop: time ? time.top - card.top : 0,
        timeIconWidth: timeIcon?.width ?? 0,
        timeIconHeight: timeIcon?.height ?? 0
      };
    });
    expect(firstCardGeometry.cardWidth).toBeGreaterThan(398);
    expect(firstCardGeometry.cardWidth).toBeLessThan(410);
    expect(firstCardGeometry.cardHeight).toBeGreaterThan(102);
    expect(firstCardGeometry.cardHeight).toBeLessThan(112);
    expect(firstCardGeometry.imageWidth).toBeGreaterThan(138);
    expect(firstCardGeometry.imageWidth).toBeLessThan(145);
    expect(firstCardGeometry.imageHeight).toBeGreaterThan(86);
    expect(firstCardGeometry.imageHeight).toBeLessThan(91);
    expect(firstCardGeometry.titleHeight).toBeLessThan(22);
    expect(firstCardGeometry.summaryHeight).toBeGreaterThan(31);
    expect(firstCardGeometry.timeTop).toBeGreaterThan(80);
    expect(firstCardGeometry.timeIconWidth).toBeGreaterThan(10);
    expect(firstCardGeometry.timeIconWidth).toBeLessThan(14);
    expect(firstCardGeometry.timeIconHeight).toBeGreaterThan(10);
    expect(firstCardGeometry.timeIconHeight).toBeLessThan(14);

    await tap(page, page.getByTestId("home-article-more"));
    await expect(page.getByTestId("article-list-page")).toBeVisible();
    await expect(page.getByTestId("article-list-title")).toHaveText("全部文章");
    await expect(page.getByTestId("article-category-all")).toHaveClass(/article-category-tab--active/);
    await expect(page.getByTestId("article-list-article-card").first()).toBeVisible();

    await openHome(page);
    const categoryResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/client/articles") &&
      response.url().includes("category=%E5%A9%9A%E7%A4%BC%E6%94%BB%E7%95%A5") &&
      response.request().method() === "GET"
    );
    await tap(page, page.getByTestId("home-menu-article").first());
    const categoryResponse = await categoryResponsePromise;
    const categoryBody = await categoryResponse.json();
    const categoryData = categoryBody.data as ArticleListResponse;
    expect(categoryData.items.length).toBeGreaterThan(0);
    expect(categoryData.items.every((item) => item.category === "婚礼攻略")).toBe(true);
    await expect(page.getByTestId("article-list-page")).toBeVisible();
    await expect(page.getByTestId("article-list-title")).toHaveText("婚礼攻略");
    await expect(page.getByTestId("article-category-婚礼攻略")).toHaveClass(/article-category-tab--active/);
    await expect(page.getByTestId("article-list-article-card")).toHaveCount(categoryData.items.length);

    await tap(page, page.getByTestId("article-list-article-card").first());
    await expect(page.getByTestId("standalone-detail-page")).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId("article-list-page")).toBeVisible();
    const noDetailCategoryTab = page.getByTestId(`article-category-${noDetailArticle.category}`);
    await expect(noDetailCategoryTab).toBeVisible();
    await noDetailCategoryTab.scrollIntoViewIfNeeded();
    const noDetailCategoryResponse = page.waitForResponse((response) =>
      response.url().includes("/api/client/articles") &&
      response.url().includes(`category=${encodeURIComponent(noDetailArticle.category)}`) &&
      response.request().method() === "GET"
    );
    await noDetailCategoryTab.click();
    await noDetailCategoryResponse;
    await expect(page.getByTestId("article-list-title")).toHaveText(noDetailArticle.category);
    await clearDevOverlay(page);
    const noDetailCard = page.getByTestId("article-list-article-card").filter({ hasText: noDetailArticle.title }).first();
    await expect(noDetailCard).toBeVisible();
    await tap(page, noDetailCard);
    await expect(page.getByTestId("article-list-page")).toBeVisible();
    await expect(page.getByTestId("standalone-detail-page")).toHaveCount(0);
  } finally {
    await adminApi(request, "PUT", `/api/admin/menu-items/${articleMenu.id}`, {
      configJson: articleMenu.configJson ?? {},
      status: articleMenu.status,
      showOnHome: articleMenu.showOnHome
    });
  }
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

test("首页接口失败展示异常页，下拉刷新可恢复且无点击重载", async ({ page }) => {
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
  await expect(page.getByText("请下拉刷新重试")).toBeVisible();
  await expect(page.getByTestId("home-reload")).toHaveCount(0);
  await page.unroute(`${apiBase}/api/client/home`);
  const recovered = page.waitForResponse((response) =>
    response.url().includes("/api/client/home") && response.request().method() === "GET" && response.ok()
  );
  await pullDownRefresh(page);
  await recovered;
  await expect(page.getByTestId("miniapp-home")).toBeVisible();
});

test("首页三张 Banner 图片失败后仅提示并通过下拉刷新恢复", async ({ page, request }) => {
  const previousBanners = await adminApi<AdminList<Banner>>(request, "GET", "/api/admin/banners");
  await setBannerStatus(request, "disabled");
  const assets = await adminApi<AdminList<MediaAsset>>(request, "GET", "/api/admin/media-assets?mediaType=image&pageSize=100");
  const bannerAssets = assets.items.slice(0, 3);
  if (bannerAssets.length < 3) throw new Error("首页 Banner E2E 需要至少三张图片资源");
  const created: Banner[] = [];

  try {
    for (const [index, asset] of bannerAssets.entries()) {
      created.push(await createBanner(request, {
        title: `E2E 失败恢复 Banner ${index + 1}`,
        imageAssetId: asset.id,
        sortOrder: 900 + index,
        switchDurationMs: 60_000
      }));
    }

    const home = await clientApi<HomeResponse>(request, "/api/client/home");
    const expectedBanners = home.banners.filter((banner) => created.some((item) => item.id === banner.id));
    expect(expectedBanners).toHaveLength(3);
    const bannerUrls = expectedBanners.map((banner) => assetUrl(banner.imageUrl));
    let failImages = true;
    let imageAttempts = 0;

    for (const url of bannerUrls) {
      await page.route(url, (route) => {
        imageAttempts += 1;
        return failImages
          ? route.fulfill({ status: 503, contentType: "text/plain", body: "image unavailable" })
          : route.continue();
      });
    }

    await openHome(page);
    const images = page.getByTestId("home-banner-image");
    const bannerState = page.getByTestId("home-banner-state");
    await expect(images).toHaveCount(3);
    await expect(bannerState).toHaveAttribute("data-failed-count", "3");
    await expect(page.getByTestId("home-banner-failure")).toHaveText("图片加载失败，请下拉刷新");
    await expect(page.getByText("重新加载图片")).toHaveCount(0);
    await expect(page.getByText("重新加载")).toHaveCount(0);
    await expect(bannerState).toHaveAttribute("data-media-refresh-version", "0");
    expect(imageAttempts).toBeGreaterThanOrEqual(3);

    failImages = false;
    const refreshed = page.waitForResponse((response) =>
      response.url().includes("/api/client/home") && response.request().method() === "GET" && response.ok()
    );
    await pullDownRefresh(page);
    await refreshed;
    await expect(bannerState).toHaveAttribute("data-media-refresh-version", "1");
    for (const [index, banner] of expectedBanners.entries()) {
      await expect(images.nth(index)).toHaveAttribute("data-current-src", banner.imageUrl);
    }
    await expect(bannerState).toHaveAttribute("data-failed-count", "0");
    await expect(page.getByTestId("home-banner-failure")).toHaveCount(0);
  } finally {
    await Promise.all(created.map((banner) => adminApi(request, "DELETE", `/api/admin/banners/${banner.id}`)));
    await Promise.all(
      previousBanners.items.map((banner) =>
        adminApi(request, "PUT", `/api/admin/banners/${banner.id}`, { status: banner.status })
      )
    );
  }
});

test("我的页面复用后台配置的小程序名与副标题", async ({ page, request }) => {
  const originalSite = await adminApi<Record<string, unknown>>(
    request,
    "GET",
    "/api/admin/site-config"
  );
  const appName = "E2E 可配置演艺服务";
  const subtitle = "E2E 专业主持・歌手・演艺团队";

  try {
    await adminApi(request, "PUT", "/api/admin/site-config", {
      ...originalSite,
      appName,
      subtitle
    });
    await page.goto("/#/pages/mine/index");

    await expect(page.getByTestId("mine-page")).toBeVisible();
    await expect(page.getByTestId("mine-app-name")).toHaveText(appName);
    await expect(page.getByTestId("mine-subtitle")).toHaveText(subtitle);
    await expect(page.getByTestId("mine-welcome")).toBeVisible();
  } finally {
    await adminApi(request, "PUT", "/api/admin/site-config", originalSite);
  }
});

test("分类和我的页面失败态无点击重载，下拉刷新恢复数据", async ({ page }) => {
  await page.route(`${apiBase}/api/client/menu-items`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "E2E_MENU_FAIL", message: "E2E menu failure" } })
    })
  );
  await page.goto("/#/pages/category/index");
  await expect(page.getByTestId("category-error-state")).toBeVisible();
  await expect(page.getByText("请下拉刷新重试")).toBeVisible();
  await expect(page.getByTestId("category-reload")).toHaveCount(0);
  await page.unroute(`${apiBase}/api/client/menu-items`);
  const categoryRecovered = page.waitForResponse((response) =>
    response.url().includes("/api/client/menu-items") && response.request().method() === "GET" && response.ok()
  );
  await pullDownRefresh(page);
  await categoryRecovered;
  await expect(page.getByTestId("category-page")).toBeVisible();
  await expect(page.getByTestId("category-error-state")).toHaveCount(0);

  await page.route(`${apiBase}/api/client/home`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "E2E_MINE_FAIL", message: "E2E mine failure" } })
    })
  );
  await page.goto("/#/pages/mine/index");
  await expect(page.getByTestId("home-error-state")).toBeVisible();
  await expect(page.getByText("请下拉刷新重试")).toBeVisible();
  await expect(page.getByTestId("home-reload")).toHaveCount(0);
  await page.unroute(`${apiBase}/api/client/home`);
  const mineRecovered = page.waitForResponse((response) =>
    response.url().includes("/api/client/home") && response.request().method() === "GET" && response.ok()
  );
  await pullDownRefresh(page);
  await mineRecovered;
  await expect(page.getByTestId("mine-page")).toBeVisible();
});

test("无 Banner 时使用占位图", async ({ page, request }) => {
  await setBannerStatus(request, "disabled");
  const home = await clientApi<HomeResponse>(request, "/api/client/home");
  await openHome(page);
  await expect(page.getByTestId("home-banner-image").first()).toHaveAttribute(
    "data-current-src",
    home.site.placeholderBannerUrl
  );
});

test("后台未配置 Banner 占位图时不显示占位区域", async ({ page, request }) => {
  const originalSite = await adminApi<Record<string, unknown>>(
    request,
    "GET",
    "/api/admin/site-config"
  );

  try {
    await setBannerStatus(request, "disabled");
    await adminApi(request, "PUT", "/api/admin/site-config", {
      ...originalSite,
      placeholderBannerAssetId: null
    });
    await openHome(page);
    await expect(page.getByTestId("home-banner-state")).toHaveCount(0);
    await expect(page.getByTestId("home-banner-image")).toHaveCount(0);
  } finally {
    await adminApi(request, "PUT", "/api/admin/site-config", originalSite);
  }
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

test("我的页面设计复核截图", async ({ page, request }) => {
  await prepareDesignReviewData(request);
  await page.goto("/#/pages/mine/index");
  await expect(page.getByTestId("mine-page")).toBeVisible();
  await expect(page.getByTestId("mine-app-name")).toHaveText("喜缘主持・演艺服务");
  await expect(page.getByTestId("mine-subtitle")).toHaveText("专业主持人・歌手・演艺团队");
  await page.screenshot({ path: "docs/design/actual-mine-h5.png", fullPage: true });
});
