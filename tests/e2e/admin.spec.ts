import { randomBytes } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { adminApi, adminPath, apiBase, chooseDetailMediaFromLibrary, chooseMediaFromLibrary, fillControl, fillNumber, loginAdminUi, selectOption, visibleSelectOption, waitForToast } from "./helpers";

test.describe.configure({ mode: "serial" });

type DetailPageSummary = { id: number; name: string; type: string; typeLabel: string; referenceCount: number };
type MediaAssetSummary = { id: number; resourceName: string; url: string };

function assetUrl(url: string) {
  return new URL(url, apiBase).href;
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
  const geometry = await preview.evaluate((root) => {
    const hero = root.querySelector(".detail-preview-hero")?.getBoundingClientRect();
    const content = root.querySelector(".detail-preview-content")?.getBoundingClientRect();
    const firstCard = root.querySelector(".detail-preview-card")?.getBoundingClientRect();
    if (!hero || !content || !firstCard) throw new Error("后台详情预览结构缺失");
    return {
      heroHeight: hero.height,
      gutter: Number.parseFloat(getComputedStyle(root.querySelector(".detail-preview-content")!).paddingLeft),
      overlap: hero.bottom - firstCard.top
    };
  });
  expect(geometry.heroHeight).toBe(202);
  expect(geometry.gutter).toBe(12);
  expect(geometry.overlap).toBeGreaterThanOrEqual(20);
  expect(geometry.overlap).toBeLessThanOrEqual(22);
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
  await expect(page.getByTestId("dashboard-pv-today")).toContainText(/\d+/);
  await expect(page.getByTestId("dashboard-pv-week")).toContainText(/\d+/);
  await expect(page.getByTestId("dashboard-pv-month")).toContainText(/\d+/);
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

test("新增菜单项并验证五种类型、首页显示和动态配置", async ({ page, request }) => {
  const existing = await adminApi<{ items: Array<{ id: number; text: string }> }>(request, "GET", "/api/admin/menu-items");
  for (const menu of existing.items.filter((item) => item.text === "E2E 联系我们")) {
    await adminApi(request, "DELETE", `/api/admin/menu-items/${menu.id}`);
  }
  await loginAdminUi(page);
  await page.getByTestId("sidebar-menu-items").click();
  await expect(page.getByText("分类菜单").first()).toBeVisible();
  const seededRow = page.getByRole("row", { name: /主持人/ }).first();
  await seededRow.getByTestId("menu-items-edit").click();
  await expect(page.getByTestId("menu-text")).toHaveValue("主持人");
  await page.getByTestId("menu-items-save").click();
  await waitForToast(page, "保存成功");

  await page.getByTestId("menu-items-create").click();
  await page.getByTestId("menu-text").fill("E2E 联系我们");
  await chooseMediaFromLibrary(page, "menu-icon-select", /icon-contact\.png/);
  await expect(page.getByTestId("menu-show-on-home")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("menu-type-select").click();
  for (const label of ["主持人", "歌手", "演员", "活动案例", "联系我们"]) {
    await expect(visibleSelectOption(page, label)).toBeVisible();
  }
  await visibleSelectOption(page, "主持人").click();
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
});

test("详情页管理可创建 BANNER 富文本并被人员引用", async ({ page, request }) => {
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
  expect(balanced && close && wide).toBeTruthy();
  if (!balanced || !close || !wide) throw new Error("详情页 BANNER 种子资源缺失");
  await page.getByRole("button", { name: "将 banner-linran-wide.png 上移" }).click();
  await expect(page.getByTestId(`detail-banner-order-${wide.id}`)).toHaveText("第 2 张");
  await expect(page.getByTestId(`detail-banner-order-${close.id}`)).toHaveText("第 3 张");
  await expect(page.getByTestId(`detail-banner-item-${balanced.id}`).locator("img")).toHaveCSS("object-fit", "contain");

  const editor = page.getByRole("textbox", { name: "详情页富文本内容" });
  await editor.fill("E2E 人员详情正文");
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
  const deleteConfirm = page.getByRole("dialog", { name: `确认删除「${created.title}」？` });
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
    type: "host",
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
  const uploadDialog = page.getByRole("dialog", { name: "上传资源" });
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
  await page.getByTestId("media-upload-button-confirm").click();
  await waitForToast(page, "上传成功");

  await page.getByTestId("media-search").locator("input").fill("E2E 未使用资源");
  await page.getByTestId("media-search").locator("input").press("Enter");
  await expect(page.getByRole("row", { name: /E2E 未使用资源/ })).toBeVisible();

  await page.getByTestId("media-upload-button-input").setInputFiles(file);
  await waitForToast(page, "已存在相同资源，已直接复用");

  await page.getByTestId("media-clean-unused").click();
  await expect(page.getByTestId("media-clean-modal")).toBeVisible();
  const row = page.getByTestId("media-clean-modal").getByRole("row", { name: /E2E 未使用资源/ });
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "删除所选资源" }).click();
  await expect(page.getByText(/已删除 1 项/).last()).toBeVisible();
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
