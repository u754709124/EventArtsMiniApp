import { expect, test } from "@playwright/test";
import { adminApi, fillControl, fillNumber, loginAdminUi, selectOption, visibleSelectOption, waitForToast } from "./helpers";

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
  await selectOption(page, "banner-image-select", /banner-default\.png/);
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
  await selectOption(page, "menu-icon-select", /icon-contact\.png/);

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

test("新增案例并标记精选", async ({ page }) => {
  await loginAdminUi(page);
  await page.getByTestId("sidebar-cases").click();
  await page.getByTestId("cases-create").click();
  await page.getByTestId("case-title").fill("E2E 精选案例");
  await page.getByTestId("case-category").fill("测试分类");
  await page.getByTestId("case-tag").fill("测试标签");
  await selectOption(page, "case-cover-select", /case-1\.png/);
  await page.getByTestId("case-summary").fill("后台自动化创建的精选案例");
  await fillControl(page.getByTestId("case-event-date"), "2026-07-09");
  await page.keyboard.press("Enter");
  await page.getByTestId("case-location").fill("杭州 E2E");
  await page.getByTestId("case-detail").fill("E2E 案例详情内容");
  await page.getByTestId("case-featured").click();
  await fillNumber(page, "case-featured-sort-order", 66);
  await fillNumber(page, "sort-order", 66);
  await selectOption(page, "status-select", "启用");
  await page.getByTestId("cases-save").click();
  await waitForToast(page, "保存成功");
  await expect(page.getByRole("row", { name: /E2E 精选案例/ })).toBeVisible();
});

test("资源上传错误尺寸提示失败，引用资源不可删除", async ({ page, request }) => {
  const media = await adminApi<{ items: { id: number; originalName: string }[] }>(request, "GET", "/api/admin/media-assets");
  const referencedAssetId = media.items.find((item) => item.originalName === "placeholder-icon.png")?.id;
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
  await page.getByTestId("sidebar-media-assets").click();
  await selectOption(page, "media-usage-select", "banner");
  await page.locator('input[type="file"]').setInputFiles({
    name: "wrong-size.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
  });
  await expect(page.getByText(/图片尺寸必须为 1420x580/).last()).toBeVisible();

  await page.getByTestId(`media-delete-${referencedAssetId}`).click();
  await page.locator(".ant-modal-confirm-btns .ant-btn-primary").click();
  await expect(page.getByText(/资源正在被使用，无法删除/).last()).toBeVisible();
});
