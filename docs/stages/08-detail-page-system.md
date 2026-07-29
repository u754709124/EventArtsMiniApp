# Stage 08 — 独立详情页统一管理

## 阶段目标

将详情页从人员/案例 owner-bound 配置升级为独立、自包含、可复用、可统一管理的内容实体。公告、首页 BANNER、人员和案例通过可空 `detailPageId` 引用详情页；小程序统一跳转 `/pages/detail/index?id=<detailPageId>`。

## 2026-07-11 刷新目标

- 新增 `docs/plans/08-standalone-detail-page-management-plan.md`，由 planner 重新生成长期目标和验收基线。
- `DetailPageConfig` 保留物理表和媒体关系，新增名称与完整 Hero 字段；`ownerType/ownerId` 改为 nullable deprecated。
- `announcements`、`banners`、`artists`、`activity_cases` 新增可空、索引、Restrict 的 `detailPageId` 外键。
- 后台新增“详情页管理”列表和设计器；四类业务表单使用统一 `DetailPageReferenceField`，不再嵌入完整详情配置。
- API 新增后台详情页 CRUD/options/references/preview 和客户端 `GET /api/client/detail-pages/:id`。
- 小程序新增公共 `pages/detail/index`，首页公告、BANNER、人员卡片、案例卡片、精选案例全部用统一跳转 helper；未绑定记录不可点击。
- 旧人员/案例详情路由改为兼容跳板：有 `detailPageId` 则 redirect 到公共详情页，无引用显示“暂无详情”。

## 当前基线

- 开始分支：`codex/phase-one-delivery`
- 规格审计基线：`656a562629948cc4c8df5847ddd7878aace60342`
- 模型分配说明提交：`71ecd2cd8aa55fb965af446b70df9692664b3f20`
- 持久计划：`docs/superpowers/plans/2026-07-11-unified-detail-page-system.md`

## 已完成：共享契约与后端

- 两种页面类型和 owner 注册表、Zod discriminated union、统一 DTO、rendererKey。
- Prisma 三张公共详情表和 SQLite 同构 DDL、索引、外键、迁移台账。
- `sanitize-html` + `parse5` 清洗、媒体 URL 重写、危险协议/样式限制、语义空内容检测。
- HTML 图片/视频关系提取，嵌套视频按原顺序拆为 `richText/video/richText` blocks。
- 旧 Artist/ActivityCase 文本与有序媒体事务迁移、幂等、防覆盖、回滚、孤儿审计。
- 事务化 DetailPageService、预览、人员/案例 CRUD、客户端详情 DTO、旧 `detail/media` 派生。
- BANNER/正文媒体引用计数、来源标签和删除保护。
- 幂等 seed 已覆盖两种人员与案例页面类型；林然为 3 图 BANNER 和完整参考富文本，案例 seed 同时覆盖图片与视频关系。

## 已完成：参考素材与示例数据

- 已归档 `898 × 1751` 原始参考图，并校验 SHA-256 `49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39`。
- `assets:slice:artist-detail` 确定性生成 26 个资源、坐标网格、显式坐标/MD5 manifest 和 contact sheet。
- 三张林然 BANNER 保留人物与活动背景；同图局部修补系统 UI，并以不透明深棕渐变重建左侧，不含姓名、标签、状态栏、导航或胶囊 UI。
- 所有切片以稳定 `SeedRecord` key 注册；富文本在实际 `MediaAsset` ID 解析后生成，重复 seed 的资源/配置/关系计数稳定。
- 林然使用完整参考模板；另一名人员为单富文本；案例分别覆盖 BANNER + 图片/视频和单富文本 + 媒体。

## 已完成：后台媒体选择与 BANNER 字段

- 现有资源库和上传动作支持可选媒体类型过滤，旧 `MediaField` 调用保持兼容；详情 BANNER 与后续编辑器共用 `MediaPickerModal`，未复制上传接口或 MD5/尺寸校验。
- `DetailBannerField` 的受控值仅为有序 `number[]`，支持 1–6 张图片、去重、缩略图/资源名/尺寸/序号、拖拽、键盘排序、显式上移/下移和删除。
- 元数据失败的 ID 保留错误 tile、原顺序、重试和删除入口；媒体类型切换使用请求序列隔离过期响应。
- 稳定 testid、44px 操作目标、可见 focus 和客户端 `detail.banner` 校验已覆盖；服务端仍独立验证数量、唯一性、存在性与图片类型。

## 已完成：受控富媒体编辑器

- Tiptap core/react/starter-kit 与必要扩展统一锁定为 `3.27.3`；使用 `immediatelyRender: false`，StrictMode 保持单一有效实例并在卸载销毁。
- 工具栏覆盖 P、H1–H4、字号/颜色、粗斜体/下划线/删除线、对齐、列表、引用、分割线、链接、图片、视频、撤销/重做和清除格式。
- 自定义 section/div/strong/span 与媒体节点保留参考模板白名单结构、class 和有界 style；完整人员模板编辑后 6 个 section 与嵌套顺序不丢。
- 媒体只接受受控 API HTML 或资源选择器建立的精确 type+ID+normalized URL 映射；拒绝临时协议、伪造 ID 换源、反斜杠/百分号伪装远程路径。

## 已完成：后台动态详情表单与人员/案例接入

- `DetailPageTypeSelect`、`DetailPageConfigFields` 和 `DetailPagePreview` 已提交为 `92cd5eb`；未选类型时仅挂载类型选择和空提示，提交被必填校验阻止。
- 动态字段完全由 shared registry 驱动；BANNER→单富文本有确认/取消路径，确认只改表单草稿，保存后由服务端清理关系；单富文本→BANNER 保留 HTML 并要求宣传语和 BANNER。
- 参考模板在覆盖已有富文本前确认，并先按真实选中媒体 ID 拉取 `MediaAsset` 后回填 canonical URL，不使用临时路径。
- 独立详情页设计器提交未保存的详情草稿到 `/api/admin/detail-pages/preview`，以服务端清洗后的 DTO 渲染 375px 预览，关闭/重试不修改表单草稿。
- 人员和案例表单保留基础字段，删除旧 `detail`/`detailMediaAssetIds` 新表单来源，改为使用统一详情页选择控件；保存 payload 只包含 `detailPageId` 引用。
- `tests/e2e/admin.spec.ts` 覆盖显式选择、BANNER 排序、图片/视频插入、预览、回填、双向切换和中文校验；最终外部 Playwright run 已通过，沙箱内 `tsx` IPC 限制已记录为环境例外。

## 已完成：Taro 公共详情 renderer

- `DetailPageRenderer` 使用 shared `rendererKey` 注册表，未知 renderer 进入受控错误状态；人员和案例路由只负责取数、PV、状态分类和 Hero adapter。
- `BannerRichTextRenderer` 渲染排序 BANNER、页码、覆盖式导航、Hero 和内容重叠；单图不循环，多图正式环境慢速轮播，E2E 可固定第一帧。
- `RichTextRenderer` 及默认 route loading 均不创建 BANNER、Hero、页码、BANNER skeleton、保留高度或负重叠。
- 富文本图片会预检并提供失败重试/remount；BANNER 图片失败可见、使用占位图且可重试；视频使用独立 Taro `Video`，有 controls、无 autoplay/loop，可信尺寸按真实比例，非法尺寸回退 16:9。
- 请求切换使用 abort 和序列门控，切换 ID 立即清空旧数据；错误、配置缺失和媒体异常有明确 retry 或状态文案。提交为 `e4780a6`，review 修复为 `3b2d7c3`，Task 13 复审结论为 Approved。

## 已完成：详情页微信分享入口

- 公共详情页新增右下角悬浮圆形分享按钮；入口不在自定义导航区，不改变微信系统胶囊，也不恢复固定底部操作栏。
- 分享按钮使用微信原生 `Button openType="share"`，页面配置启用 `enableShareAppMessage`，分享回调路径固定为 `/pages/detail/index?id=<当前详情页ID>`。
- 分享标题优先使用当前详情 Hero 标题，空值回退详情页名称；BANNER 富文本详情使用排序后的首张有效 BANNER 作为分享图，单富文本或无可靠图片时省略 `imageUrl`。
- 用户提供的 `/Users/chdon/Downloads/icon_font.png` 已无损复制为 `apps/miniapp/src/assets/generated/icon-share.png`；副本为 `64×64`、带 alpha，SHA-256 与原文件一致，保留深灰黑上传/分享形态。
- 分享 payload 由纯模型生成，只有当前路由 ID 为正整数且 DTO ID 一致时才可分享；加载、错误、非法 ID 或迟到旧请求不会生成错误详情深链。
- H5 生产页面隐藏微信原生分享按钮，不模拟分享面板，也不保留布局占位；H5 E2E 断言不存在不可用分享按钮。
- 仍禁止收藏、在线咨询、立即预约、导航区分享按钮、第二个分享入口、固定底部业务栏和旧 spacer。
- 微信分享卡片的端到端点击进入能力需要微信开发者工具或真机验证；自动化测试不能替代该验证。

## 已完成：Task 14 视觉文档、E2E 与截图证据

- `docs/design/detail-page-system.md` 已记录公共架构、接口契约、HTML/CSS 白名单、媒体生命周期、SQLite 迁移、Tiptap 选择、Taro renderer/adapters、参考资产、测量 token、平台差异、移除业务操作和新增第三种 renderer 的八步流程。
- `apps/miniapp/src/components/detail-page/detail-page.scss` 使用 `$detail-*` 变量承接参考图测量值，避免在组件内散落视觉常量。
- `tests/e2e/miniapp-h5.spec.ts` 已新增四种详情页行为断言、ID race、错误重试、四张截图和 overlay/diff/hash 生成逻辑，提交为 `06ab56c`；最终 `pnpm e2e` 与 `pnpm release:check` 均真实执行通过。
- 四张详情截图、`overlay-artist-detail.png`、`diff-artist-detail.png` 与 `detail-page-visual-evidence.json` 已生成，viewport 为 `427×922`、`deviceScaleFactor: 2`。
- README、API 文档和完整设计文档提交为 `c240aba`，补充公共详情契约、预览接口、seed 稳定示例、切图命令、媒体保护和视觉证据命令。

## 已完成：最终回归修复

- 修复 `RichTextEditorField` 连续插入图片后再插入视频时，Tiptap 选中的媒体节点被替换导致图片丢失的问题。当前逻辑识别已选中的 `assetImage`/`assetVideo` 节点，并把新媒体插入到选区之后。
- `RichTextEditorField.test.tsx` 增加图片与视频连续插入后两者都保留的断言。
- `DetailPageTypeSelect` 为确认切换弹窗增加稳定 `aria-label`，避免 AntD 中文按钮文本被渲染为带空格的 accessible name。
- Miniapp H5 详情 E2E 改用 Taro H5 hash 路由，单富文本首块间距断言改为测量真实 `detail-rich-content` 相对导航的距离。
- 资源库上传 E2E 改为用 Sharp 生成唯一 `2×2` PNG，避免与 seed/前置用例的 1×1 PNG 撞 MD5 后直接复用而不展示资源名确认弹窗。
- 资源删除保护 E2E 在断言前搜索 `placeholder-icon.png`，避免分页导致引用资源按钮不在当前页。

## 当前验证证据

- 2026-07-18 详情失败恢复入口统一：
  - 独立详情页、旧人员详情和旧案例详情均启用原生下拉刷新；接口失败只显示加载失败提示，不再渲染可点击重载按钮。
  - BANNER 富文本图片及视频加载失败只显示非交互提示，不提供图片或视频点击重试；页面级恢复统一由下拉刷新重新请求详情数据和媒体节点。
  - 详情资源 hook 保留中止请求和最新请求保护，并允许下拉刷新等待真实请求结果后停止刷新动画。
  - Miniapp H5 聚焦 E2E 通过：独立详情错误恢复、旧人员/案例详情错误恢复、详情 Banner 与视频失败提示均成功；包含在最终 10/10 聚焦回归中。
  - `pnpm --filter miniapp test` 通过（10 files / 68 tests），`pnpm lint`、`pnpm test`、H5 构建、WeApp 构建和 `git diff --check` 均通过。
  - 微信开发者工具或真机的视频 `onError` 与长期媒体源故障尚未人工复核；当前证据为 H5 故障注入、单元测试和 WeApp 生产构建。
- 2026-07-14 详情页真机布局与富文本显示修复：
  - revision 2 将 BANNER 改为 `424rpx` 最小高度的内容驱动布局；Hero 进入正常流，顶部复用导航安全区，底部预留 `42rpx` 重叠加 `24rpx` 可见间距，长标题、4 标签、位置和元数据可自然撑高。
  - shared 可信展示增强器为 `h1` 幂等生成 marker/content 兄弟节点并使用 flex 中心对齐；小程序标题为 `28rpx`，Admin 375px 预览为 `14px`，marker 不超过 `1em` 且不再使用 `text-top` 或负 margin。图片响应式及原媒体属性保持不变。
  - Admin BANNER 预览按半比例镜像流式契约：`212px` 最小高度、`72px 115px 33px 22px` 内容 padding、覆盖导航 `20px + 44px`、首卡负重叠 `21px`，人员与活动案例长内容复用同一预览结构。
  - 定向单测：shared 2 files / 32 tests、miniapp 6 files / 33 tests、Admin 19 files / 80 tests，均通过；覆盖已有 style、重复处理、多行标题、marker 高度契约、图片属性保留和 Admin CSS/DOM 结构。
  - `pnpm test`：通过，48 files / 318 tests（shared 32、miniapp 33、API 165、Admin 80、deploy 8）。
  - shared typecheck、Admin 生产构建和 changed-file ESLint 通过；Admin 构建仅有既有的单 chunk 大小警告。
  - Admin 定向 Playwright “详情页管理预览可创建 BANNER 富文本并被人员引用”通过，1/1；浏览器实测预览的导航/Hero/首卡净空、`14px` 标题和 marker/content 中心差均满足约束。
  - `NODE_ENV=development pnpm e2e --project=miniapp-h5 --grep "详情"`：通过，12/12；覆盖人员与活动案例长 Hero、全部标签与元数据、首卡净空、按 750rpx 动态换算的 `28rpx` 标题、竖线中心对齐、图片自适应及原详情回归。
  - `NODE_ENV=development pnpm e2e`：通过，48/48。根 `.env` 为生产配置，故本地 E2E 显式使用 development；额外诊断确认 `NODE_ENV=test` 的 H5 watch 会因 miniapp 未直连 `@babel/runtime` 而失败，该工具环境问题未用于判定产品页面结果。
  - changed-file ESLint：通过；`pnpm lint` 未通过，阻塞为本次未改动的 `apps/miniapp/src/services/api.test.ts:84:10` 既有未使用变量 `rateLimitedBody`。
  - `pnpm --filter miniapp build:h5` 与 `pnpm build:weapp` 均通过；H5 和微信小程序产物可正常生成。
  - 自动化证据为上述 shared HTML 输出测试、小程序/Admin 单测、Admin/H5 浏览器 E2E、全仓单测、变更文件 ESLint、shared/Admin/H5/WeApp 构建、`git diff --check` 与源码审查；微信开发者工具/真机仍需分别复核人员与活动案例的返回按钮净空、标题竖线和正文图片完整缩放，未执行前不宣称 revision 2 已完成。
- 2026-07-12 详情页分享入口更新：
  - `pnpm --filter miniapp test`：通过，4 files / 22 tests。
  - `pnpm lint`：通过。
  - `pnpm test`：通过，shared 26 tests、miniapp 22 tests、admin 60 tests、api 100 tests。
  - `pnpm e2e -- --project=miniapp-h5 --grep "详情页"`：命令实际触发 46/46 Playwright tests，通过；覆盖 admin 与 miniapp-h5 全量。
  - `pnpm --filter miniapp build:h5`：通过。
  - `pnpm build:weapp`：通过，详情页产物包含 `openType="share"`、`useShareAppMessage` 和 `enableShareAppMessage`。
  - `pnpm release:check`：通过，覆盖 lint、unit、E2E、API build、Admin build、H5 build 和 WeApp build。
  - 微信开发者工具或真机“发送给朋友”卡片点击直达验证尚未在本机自动化环境执行，不能宣称端到端已通过。
- 2026-07-11 最终完成审计基线：
  - `git branch --show-current`：`codex/phase-one-delivery`。
  - `git rev-parse HEAD`：`e86c9d8574b5e953bdbfbdced6c04705e754d5c4`。
  - `git log -1 --oneline`：`e86c9d8 fix(ui): repair carousels and image previews`。
  - `git status --short --branch`：工作区包含本阶段修改和既有 `AGENTS.md` 本地修改；未执行 stage/commit。
- `pnpm release:check`：2026-07-11 在沙箱外真实执行通过；串行完成 `pnpm lint`、`pnpm test`、`pnpm e2e`、`pnpm --filter api build`、`pnpm --filter admin build`、`pnpm --filter miniapp build:h5`、`pnpm build:weapp`。
- `pnpm test`：通过；shared 2 files / 22 tests，miniapp 1 file / 13 tests，admin 9 files / 36 tests，api 9 files / 81 tests。
- `pnpm e2e`：通过；37/37 Playwright tests passed，其中 admin 12/12，miniapp-h5 25/25。E2E 覆盖独立详情页设计器、四类业务引用、公告/BANNER/人员/案例统一跳转、未绑定不跳转、旧路由兼容、公共详情 renderer、图片/视频、错误重试和视觉截图。
- `pnpm --filter api build`：通过，Prisma generate + `tsc --noEmit`。
- `pnpm --filter admin build`：通过，`tsc --noEmit && vite build`。
- `pnpm --filter miniapp build:h5`：通过。
- `pnpm build:weapp`：通过。
- `git diff --check`：通过。
- 端口清理确认：最终审计后 `3001`、`5173`、`10086` 均无监听进程。
- `pnpm install`：Already up to date，pnpm `11.3.0`，无 lockfile 变更。
- `pnpm assets:slice:artist-detail`：连续运行两次，均生成 26 个 deterministic artist detail assets；两次 SHA-256 清单 `diff` 无输出。
- `pnpm db:push`：沙箱内因 `tsx` IPC pipe `listen EPERM` 失败；按权限规则在沙箱外重跑通过，输出 `SQLite schema ready`。
- `pnpm db:seed`：沙箱内因 `tsx` IPC pipe `listen EPERM` 失败；按权限规则在沙箱外重跑通过，输出 seed 完成信息。G02 后该命令仅写演示内容，不再创建管理员。
- `pnpm lint`：通过。
- focused admin E2E：`pnpm e2e --project=admin --grep "人员 BANNER 富文本"`、`pnpm e2e --project=admin --grep "表单本地上传"`、`pnpm e2e --project=admin --grep "资源库上传"` 均通过。
- focused miniapp E2E：`pnpm e2e --project=miniapp-h5 --grep "人员 BANNER 富文本详情"` 与 `pnpm e2e --project=miniapp-h5 --grep "人员单富文本详情"` 均通过。
- focused admin unit：`pnpm --filter admin exec vitest run src/detail-pages/RichTextEditorField.test.tsx src/detail-pages/DetailPageConfigFields.test.tsx` 2 files / 15 tests passed。
- WeChat dist inspection：`apps/miniapp/dist` 为 `3.1M`，包含 `app.json`、`pages/artists/detail.*`、`pages/cases/detail.*`、`assets/generated/*` 等微信端产物。
- 禁用业务动作搜索：详情生产源码对 `favorite/share/consult/booking/fixed-bottom/business-action/action-spacer/action-bar/收藏/分享/咨询/预约/立即预约/在线咨询` 无命中；仅单测断言字符串命中。
- 重复实现搜索：sanitizer/service/editor/renderer 均集中在 `packages/shared/src/detail-pages.ts`、`apps/api/src/detail-pages/*`、`apps/admin/src/detail-pages/*`、`apps/miniapp/src/components/detail-page/*`。

## 视觉证据

- `docs/design/actual-artist-banner-rich-text.png`：`854×1844`，SHA-256 `5a04dec27eb5f35a55d6ddcba6ebc04375f1d7c094687f48cc1e506aa2ec21a3`。
- `docs/design/actual-artist-rich-text.png`：`854×1844`，SHA-256 `e2aa5a7788f88a342d6b641189ceb6181cff141867fecce397f8027abbdc1175`。
- `docs/design/actual-case-banner-rich-text.png`：`854×1844`，SHA-256 `7409b30300df8c6c88e0cd6267f7c54a0e2ea64fc2455bbe369ab4d261a00583`。
- `docs/design/actual-case-rich-text.png`：`854×1844`，SHA-256 `d7afc217bb75087057846aef514e9806096d365aa66266aafca5ca79d4b4bb26`。
- `docs/design/overlay-artist-detail.png`：`854×1665`，SHA-256 `c549a33645b0b48e8c2eeef553ee2cb6b651f9c35901839da44efbc2a80882fb`。
- `docs/design/diff-artist-detail.png`：`854×1665`，SHA-256 `8b9478f63db5768335cb3c2a85c0da08954dcfdbeb567d768d7baf9041e5f19f`。
- `docs/design/detail-page-visual-evidence.json` 记录 viewport、对齐方式和上述哈希。

## 迁移覆盖

- 新库重复初始化。
- 旧人员纯文本转义和换行段落。
- 旧案例图片/视频顺序和重复资源消除。
- 已有新配置不覆盖。
- 多次迁移不重复。
- 非空不可解释 `legacyMediaJson` 整体回滚。
- 迁移后无多态 owner 孤儿。

## 待完成

- revision 2 的代码、自动化测试、H5/WeApp 构建与文档已完成；仍需在微信开发者工具或真机分别复核人员和活动案例的导航净空、首卡净空、标题竖线居中与正文图片完整缩放。
- 全仓 `pnpm lint` 仍被本次未改动的 `apps/miniapp/src/services/api.test.ts:84:10` 既有未使用变量阻塞。

## 已知取舍

- 旧数据库字段只读保留；新保存不双写，兼容响应从 DetailPageConfig 派生。
- blocks 始终从已清洗 HTML 派生，不写数据库。
- SQLite 多态 owner 无真实外键，通过公共服务和孤儿审计保证一致性。

## 2026-07-29 BANNER 安全区与可选展示

- `banner_rich_text` 宣传语改为可选；现代及兼容输入均将缺省、空字符串和纯空白规范化为 `""`，DTO 和数据库结构不变。
- 空类型标题不再回退为“BANNER + 富文本”；Hero 的可选宣传语、标签、地点和元数据均按有效内容创建节点，空 meta 不保留容器或间距。
- BANNER 前新增正常流中的状态栏/胶囊安全顶部与 44px 导航栏，暖白渐变轻微延伸到图片顶缘；BANNER 保留 `424rpx` 可见最小高度，Hero 顶部只使用相对 BANNER 的小间距。
- 加载骨架和 Admin 375px 移动预览使用相同区块顺序；Contact 由菜单 `configJson` 驱动，未绑定详情页的案例卡不显示 CTA。
- Shared、API、Admin、Miniapp 与 Playwright 已增加宣传语规范化、空节点、布局几何、Contact 状态、案例 CTA 和人员标签宽度覆盖；完整验证结果以本次执行记录为准。
- `pnpm test` 通过：Shared `56`、Miniapp `70`、API `266`、Admin `166`、deploy `9`、build-script `4`。
- 最终 `pnpm e2e` 通过 `68/68`；其中覆盖安全导航与 BANNER 净空、空 Hero 可选节点、Contact 部分/全空配置、无详情案例 CTA 和人员标签实际宽度，并刷新详情页与人员列表视觉证据。
- `pnpm lint`、`pnpm build:weapp` 和 `git diff --check` 均通过；WeApp bundle budget 检查通过。
- Playwright 临时数据库名加入 UUID，避免操作系统复用 PID 时命中旧 E2E 身份平面而阻塞首管理员 bootstrap。
