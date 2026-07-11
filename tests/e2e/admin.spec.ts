import { expect, test } from "@playwright/test";
import { adminApi, chooseDetailMediaFromLibrary, chooseMediaFromLibrary, fillControl, fillNumber, loginAdminUi, selectOption, visibleSelectOption, waitForToast } from "./helpers";

test.describe.configure({ mode: "serial" });

test("登录页展示", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("后台管理系统")).toBeVisible();
  await expect(page.getByTestId("login-username")).toBeVisible();
  await expect(page.getByTestId("login-password")).toBeVisible();
});

test("未登录访问后台跳转登录", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
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
  await expect(page.getByRole("row", { name: /E2E 公告/ })).toContainText("disabled");
});

test("新增 Banner", async ({ page }) => {
  await loginAdminUi(page);
  await page.getByTestId("sidebar-banners").click();
  await page.getByTestId("banners-create").click();
  await page.getByTestId("banner-title").fill("E2E Banner");
  await chooseMediaFromLibrary(page, "banner-image-select", /banner-default\.png/);
  await page.getByTestId("banner-image-select-preview").hover();
  await expect(page.getByText("banner-default.png").last()).toBeVisible();
  await selectOption(page, "banner-link-type", "none");
  await fillNumber(page, "banner-switch-duration", 1500);
  await fillNumber(page, "sort-order", 77);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("banners-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByRole("row", { name: /E2E Banner/ })).toBeVisible();
});

test("新增菜单项并验证五种类型和动态配置", async ({ page }) => {
  await loginAdminUi(page);
  await page.getByTestId("sidebar-menu-items").click();
  await page.getByTestId("menu-items-create").click();
  await page.getByTestId("menu-text").fill("E2E 联系我们");
  await chooseMediaFromLibrary(page, "menu-icon-select", /icon-contact\.png/);

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
  await page.getByTestId("menu-items-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByRole("row", { name: /E2E 联系我们/ })).toBeVisible();
});

test("人员管理保留列表字段并要求主动选择详情页类型", async ({ page }) => {
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
  await expect(page.getByTestId("detail-page-empty-hint")).toContainText("请先选择详情页类型");
  await expect(page.getByTestId("detail-rich-text-editor")).toHaveCount(0);
});

test("人员 BANNER 富文本可排序、插入媒体、预览、回填并切换为单富文本", async ({ page, request }) => {
  const existingArtists = await adminApi<{ items: Array<{ id: number; name: string }> }>(request, "GET", "/api/admin/artists?pageSize=100");
  for (const artist of existingArtists.items.filter((item) => item.name === "E2E 共享详情演员")) {
    await adminApi(request, "DELETE", `/api/admin/artists/${artist.id}`);
  }
  await loginAdminUi(page);
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

  await selectOption(page, "detail-page-type", "BANNER + 富文本");
  await page.getByTestId("detail-hero-subtitle").fill("E2E 专业舞台表达");
  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-balanced.png");
  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-close.png");
  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-wide.png");

  const media = await adminApi<{ items: Array<{ id: number; resourceName: string }> }>(request, "GET", "/api/admin/media-assets?pageSize=100");
  const balanced = media.items.find((asset) => asset.resourceName === "banner-linran-balanced.png");
  const close = media.items.find((asset) => asset.resourceName === "banner-linran-close.png");
  const wide = media.items.find((asset) => asset.resourceName === "banner-linran-wide.png");
  expect(balanced && close && wide).toBeTruthy();
  if (!balanced || !close || !wide) throw new Error("详情页 BANNER 种子资源缺失");
  await page.getByRole("button", { name: "将 banner-linran-wide.png 上移" }).click();
  await expect(page.getByTestId(`detail-banner-order-${wide.id}`)).toHaveText("第 2 张");
  await expect(page.getByTestId(`detail-banner-order-${close.id}`)).toHaveText("第 3 张");

  const editor = page.getByRole("textbox", { name: "详情页富文本内容" });
  await editor.fill("E2E 人员详情正文");
  await chooseDetailMediaFromLibrary(page, page.getByRole("button", { name: "插入图片" }), "advantage-experience.png");
  await chooseDetailMediaFromLibrary(page, page.getByRole("button", { name: "插入视频" }), "detail-case-demo.mp4");
  await expect(editor.locator("img[data-media-asset-id]")).toHaveCount(1);
  await expect(editor.locator("video[data-media-asset-id]")).toHaveCount(1);

  await page.getByTestId("detail-page-preview").click();
  const preview = page.getByRole("dialog", { name: "移动端安全预览" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("E2E 共享详情演员");
  await expect(preview.locator("video")).toHaveCount(1);
  await preview.getByRole("button", { name: "关闭预览" }).click();

  await page.getByTestId("artists-save").click();
  await waitForToast(page, "保存成功");

  const record = await adminApi<{ items: Array<{ id: number; name: string; location: string; badge: string; tags: string[]; tagsJson: string[]; detailPage: { type: string; banners: Array<{ assetId: number }>; richTextHtml: string } }> }>(request, "GET", "/api/admin/artists?pageSize=100");
  const created = record.items.find((item) => item.name === "E2E 共享详情演员");
  expect(created).toMatchObject({ location: "杭州 E2E", badge: "测试主持", tags: ["标签一", "标签二", "标签三"] });
  expect(created?.tagsJson).toEqual(["标签一", "标签二", "标签三"]);
  expect(created?.detailPage.type).toBe("banner_rich_text");
  expect(created?.detailPage.banners.map((banner) => banner.assetId)).toEqual([balanced.id, wide.id, close.id]);
  expect(created?.detailPage.richTextHtml).toContain("data-media-asset-id");
  if (!created) throw new Error("新建人员未出现在后台列表接口");

  const row = page.getByTestId(`artists-row-${created.id}`);
  await expect(row).toContainText("杭州 E2E");
  await expect(row).toContainText("测试主持");
  await expect(row).toContainText("BANNER + 富文本");
  await row.getByTestId("artists-edit").click();
  await expect(page.getByTestId("artist-tags").locator(".ant-select-selection-item")).toHaveCount(3);
  await expect(page.getByTestId(`detail-banner-order-${balanced.id}`)).toHaveText("第 1 张");
  await expect(page.getByTestId(`detail-banner-order-${wide.id}`)).toHaveText("第 2 张");
  await expect(page.getByRole("textbox", { name: "详情页富文本内容" }).locator("video[data-media-asset-id]")).toHaveCount(1);

  await selectOption(page, "detail-page-type", "单富文本");
  const switchDialog = page.getByRole("dialog", { name: "切换为单富文本？" });
  await expect(switchDialog).toBeVisible();
  await switchDialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("detail-banner-field")).toBeVisible();
  await selectOption(page, "detail-page-type", "单富文本");
  await page.getByRole("dialog", { name: "切换为单富文本？" }).getByRole("button", { name: "确认切换" }).click();
  await expect(page.getByTestId("detail-banner-field")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "详情页富文本内容" })).toContainText("E2E 人员详情正文");
  await page.getByTestId("artists-save").click();
  await waitForToast(page, "保存成功");

  const switched = await adminApi<{ items: Array<{ id: number; detailPage: { type: string; banners: unknown[]; richTextHtml: string } }> }>(request, "GET", "/api/admin/artists?pageSize=100");
  const switchedArtist = switched.items.find((item) => item.id === created.id);
  expect(switchedArtist?.detailPage.type).toBe("rich_text");
  expect(switchedArtist?.detailPage.banners).toEqual([]);
  expect(switchedArtist?.detailPage.richTextHtml).toContain("E2E 人员详情正文");
});

test("案例单富文本回填后切换 BANNER，展示中文校验并成功保存", async ({ page, request }) => {
  const existingCases = await adminApi<{ items: Array<{ id: number; title: string }> }>(request, "GET", "/api/admin/cases?pageSize=100");
  for (const caseItem of existingCases.items.filter((item) => item.title === "E2E 共享详情案例")) {
    await adminApi(request, "DELETE", `/api/admin/cases/${caseItem.id}`);
  }
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
  await expect(page.getByTestId("detail-page-empty-hint")).toBeVisible();
  await page.getByTestId("cases-save").click();
  await expect(page.getByText("请选择详情页类型").last()).toBeVisible();

  await selectOption(page, "detail-page-type", "单富文本");
  await expect(page.getByTestId("detail-banner-field")).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "详情页富文本内容" });
  await editor.fill("E2E 案例详情正文");
  await chooseDetailMediaFromLibrary(page, page.getByRole("button", { name: "插入图片" }), "case-brand-launch.png");
  await chooseDetailMediaFromLibrary(page, page.getByRole("button", { name: "插入视频" }), "detail-case-demo.mp4");
  await page.getByTestId("cases-save").click();
  await waitForToast(page, "保存成功");

  const cases = await adminApi<{ items: Array<{ id: number; title: string; detailPage: { type: string; banners: Array<{ assetId: number }>; richTextHtml: string } }> }>(request, "GET", "/api/admin/cases?pageSize=100");
  const created = cases.items.find((item) => item.title === "E2E 共享详情案例");
  expect(created?.detailPage.type).toBe("rich_text");
  expect(created?.detailPage.banners).toEqual([]);
  expect(created?.detailPage.richTextHtml).toContain("data-media-asset-id");
  if (!created) throw new Error("新建案例未出现在后台列表接口");

  const row = page.getByTestId(`cases-row-${created.id}`);
  await expect(row).toContainText("单富文本");
  await row.getByTestId("cases-edit").click();
  await expect(page.getByRole("textbox", { name: "详情页富文本内容" })).toContainText("E2E 案例详情正文");
  await selectOption(page, "detail-page-type", "BANNER + 富文本");
  await page.getByTestId("detail-hero-subtitle").fill("E2E 案例 BANNER 宣传语");
  await page.getByTestId("cases-save").click();
  await expect(page.getByText("请至少选择 1 张详情页 BANNER").last()).toBeVisible();
  await expect(page.getByTestId("cases-drawer")).toBeVisible();

  await chooseDetailMediaFromLibrary(page, page.getByTestId("detail-banner-add"), "banner-linran-wide.png");
  await page.getByTestId("cases-save").click();
  await waitForToast(page, "保存成功");
  const updatedCases = await adminApi<{ items: Array<{ id: number; detailPage: { type: string; banners: Array<{ assetId: number }> } }> }>(request, "GET", "/api/admin/cases?pageSize=100");
  const updated = updatedCases.items.find((item) => item.id === created.id);
  expect(updated?.detailPage.type).toBe("banner_rich_text");
  expect(updated?.detailPage.banners).toHaveLength(1);
});

test("表单本地上传在客户端拦截错误尺寸，引用资源不可删除", async ({ page, request }) => {
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
  await expect(page.getByText(/Banner 图片尺寸必须为 1420x580/).last()).toBeVisible();

  await page.locator(".ant-drawer-close").click();
  await page.getByTestId("sidebar-media-assets").click();
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

  const file = {
    name: "e2e-unused.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
  };
  await page.getByTestId("media-upload-button-input").setInputFiles(file);
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
