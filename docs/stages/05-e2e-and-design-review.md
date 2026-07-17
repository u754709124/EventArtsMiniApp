# Stage 5 - E2E and Design Review

## 阶段目标
完成 Admin、Miniapp H5 自动化测试与首页设计复核，形成可重复执行的端到端验证入口。

## 功能范围
Playwright 后台和 H5 流程、接口夹具、首页截图、模块对照、测试态数据清理。

## 主要文件
- `playwright.config.ts`
- `tests/e2e/helpers.ts`
- `tests/e2e/admin.spec.ts`
- `tests/e2e/miniapp-h5.spec.ts`
- `docs/design/actual-home-h5.png`
- `docs/design/reference-home.png`
- `apps/miniapp/src/assets/generated/tab-*.png`

## 数据结构或接口
测试使用 seed 数据、后台鉴权接口、CMS CRUD 接口、`GET /api/client/home`、`POST /api/client/track/page-view`。E2E 启动时先执行 `db:push`、`db:seed`，再用一次性 `admin:bootstrap` 创建测试管理员，确保场景可重复且不依赖默认账号。

## 测试方式
- `pnpm lint`：通过。
- `pnpm test`：通过，包含 shared 与 api Vitest。
- `pnpm e2e`：通过，Admin 与 Miniapp H5 共 21 个 Playwright 场景。
- 2026-07-10 复核：`pnpm e2e` 再次通过；Playwright 运行记录为 `passed`、无失败用例，并重新生成 `docs/design/actual-home-h5.png`。
- 2026-07-17 EdgeOne 复核：EdgeOne 聚焦 E2E 1/1 通过；Admin 全部 20 个场景已在连续批次中覆盖通过。完整 `pnpm e2e` 当前未通过：小程序 H5 开发构建缺少直接依赖 `@babel/runtime`，首个 H5 场景无法加载，后续 H5 场景未执行；该问题属于本任务明确禁止修改的小程序范围，未将其误报为通过。

## 验收清单
- [x] Admin E2E 覆盖核心 CMS 流程
- [x] Miniapp H5 E2E 覆盖首页与跳转
- [x] 设计截图完成
- [x] 模块复核记录完成
- [x] 资源上传非推荐尺寸允许进入上传流程，引用资源删除失败完成验证
- [x] 首页接口失败、重新加载、图片占位完成验证
- [x] 媒体空态、资源库导入、推荐尺寸提示、hover 名称和解除关联
- [x] MD5 复用、资源筛选、批量清理、视频预览和案例媒体键盘排序
- [x] EdgeOne 未配置态、系统配置元数据、成功后密钥清空和浏览器无残留
- [x] 一次刷新更新七张卡片、重复点击无并发、4/2/1 列目标视口与无页面横向滚动

## 已完成事项
- 已配置 Playwright `admin` 与 `miniapp-h5` 两个项目，统一启动 API、Admin、Taro H5。
- 后台 E2E 覆盖登录与看板、首页配置、公告、Banner、动态菜单、案例媒体追加/键盘排序/保存回显、视频导入预览、非推荐尺寸上传流程、MD5 复用、资源筛选、引用删除保护和批量清理。
- EdgeOne E2E 通过 Playwright route 注入确定性配置与计费响应，不写测试数据库、不访问腾讯云也不使用真实 CAM；覆盖菜单/路由、未配置入口、配置元数据、密码输入清空、URL/DOM/localStorage/sessionStorage 无凭证残留、四张卡片、延迟提示和一次聚合刷新。
- EdgeOne 看板在 1440、1024、768、375 px 视口分别断言 4/4/2/1 列，并复用文档级横向溢出检查；刷新按钮断言可访问名称、原生键盘焦点能力和 pending 重复点击只产生一个请求。
- Ant Design 命令式弹窗没有稳定的 dialog 可访问名称；既有 E2E 已改用可见 dialog 加标题文本过滤，文章删除、上传资源和备份弹窗聚焦复跑通过。
- H5 E2E 覆盖首页加载、站点文案、公告隐藏/展示/切换、无 Banner 时占位、指示点、五类菜单跳转、精选案例详情、首页异常重试、图片失败占位。
- H5 E2E 新增视觉几何覆盖：标题顶端不超过 44px、Banner 顶端不超过 138px 且维持 710:290 比例、首张精选案例卡片高度不超过 220px。
- 已生成设计复核截图 `docs/design/actual-home-h5.png`。
- 已补充 TabBar PNG 图标，修复 H5 无 `iconPath` 时显示占位框的问题。
- 已在设计截图前恢复 seed 样式数据，避免 E2E 新增项污染设计复核画面。

## 设计复核
- 参考图来源：用户随任务提供的小程序首页截图，已保存为 `docs/design/reference-home.png`。
- 实际截图：`docs/design/actual-home-h5.png`。
- 顶部标题：通过，标题黑色加粗、副标题棕金色、H5 标题顶端实测 36px；页面顶部、公告和 Banner 的纵向位置与参考图移动端节奏基本一致。
- 公告栏：通过，浅暖背景、红色概述、黑色内容、右箭头、横向溢出处理和多公告切换均已覆盖。
- Banner：通过，固定比例、圆角、cover 展示、指示点和默认图策略均已覆盖。
- 菜单卡片：通过，5 个菜单横向展示、图标尺寸和暖白卡片接近参考图。
- 精选案例：通过，标题、更多入口、三张横向卡片、标签、封面、详情按钮符合一期范围；首卡实测 219px 高，标题和简介最多两行以保持卡片对齐。
- 固定 TabBar：通过，四项固定路由、选中态颜色和 PNG 图标已在 H5 截图中确认。
- 结论：通过设计复核；复核方式为模块级视觉对照，不做像素级差异判定。

## 对应 git commit hash
a8e8931

## 已知问题或设计取舍
- H5 截图使用浏览器字体和 Taro H5 渲染，字号与微信客户端会有细微差异；最终微信端以 `build:weapp` 产物在开发者工具中复核。
- Playwright H5 测试会隐藏 Taro dev overlay，避免开发态非业务 promise rejection 遮挡页面。
- Admin E2E 通过 Vite proxy 调用 API，保持后台前端同源请求路径与生产部署形态一致。
- 截图复核不做像素级比较，以模块布局和视觉接近为准。
- 2026-07-10 的截图复核继续确认：H5 未模拟微信状态栏与胶囊按钮，使用单独的 36px 安全区；五项菜单是一期范围，参考图中其余营销区块不纳入交付。
