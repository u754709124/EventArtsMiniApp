# Stage 08 — 通用详情页系统

## 阶段目标

为人员与案例建立公共详情配置、服务端安全富文本、统一后台表单和 Taro 渲染器，并保留 SQLite 历史数据兼容能力。

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
- 移动端预览提交未保存的 nested `detailPage` 到 `/api/admin/detail-pages/preview`，以服务端清洗后的 DTO 渲染 375px 预览，关闭/重试不修改表单草稿。
- 人员和案例表单已在 `1c309d5` 接入公共组件，保留基础字段，删除旧 `detail`/`detailMediaAssetIds` 新表单来源，列表展示详情类型和摘要；保存 payload 只包含规范化 nested `detailPage`。
- `tests/e2e/admin.spec.ts` 覆盖显式选择、BANNER 排序、图片/视频插入、预览、回填、双向切换和中文校验；最终外部 Playwright run 已通过，沙箱内 `tsx` IPC 限制已记录为环境例外。

## 已完成：Taro 公共详情 renderer

- `DetailPageRenderer` 使用 shared `rendererKey` 注册表，未知 renderer 进入受控错误状态；人员和案例路由只负责取数、PV、状态分类和 Hero adapter。
- `BannerRichTextRenderer` 渲染排序 BANNER、页码、覆盖式导航、Hero 和内容重叠；单图不循环，多图正式环境慢速轮播，E2E 可固定第一帧。
- `RichTextRenderer` 及默认 route loading 均不创建 BANNER、Hero、页码、BANNER skeleton、保留高度或负重叠。
- 富文本图片会预检并提供失败重试/remount；BANNER 图片失败可见、使用占位图且可重试；视频使用独立 Taro `Video`，有 controls、无 autoplay/loop，可信尺寸按真实比例，非法尺寸回退 16:9。
- 请求切换使用 abort 和序列门控，切换 ID 立即清空旧数据；错误、配置缺失和媒体异常有明确 retry 或状态文案。提交为 `e4780a6`，review 修复为 `3b2d7c3`，Task 13 复审结论为 Approved。

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

- `pnpm install`：Already up to date，pnpm `11.3.0`，无 lockfile 变更。
- `pnpm assets:slice:artist-detail`：连续运行两次，均生成 26 个 deterministic artist detail assets；两次 SHA-256 清单 `diff` 无输出。
- `pnpm db:push`：沙箱内因 `tsx` IPC pipe `listen EPERM` 失败；按权限规则在沙箱外重跑通过，输出 `SQLite schema ready`。
- `pnpm db:seed`：沙箱内因 `tsx` IPC pipe `listen EPERM` 失败；按权限规则在沙箱外重跑通过，输出 `Seed complete: admin/admin123456`。
- `pnpm lint`：通过。
- `pnpm test`：通过；shared 2 files / 22 tests，miniapp 1 file / 13 tests，admin 9 files / 36 tests，api 9 files / 83 tests。
- `pnpm e2e`：通过；35/35 Playwright tests passed，其中 admin 12/12，miniapp-h5 23/23。
- `pnpm --filter api build`：通过，Prisma generate + `tsc --noEmit`。
- `pnpm --filter admin build`：通过，已无 Vite 大 chunk warning。
- `pnpm --filter miniapp build:h5`：通过，已无 Webpack asset/entrypoint size warnings。
- `pnpm build:weapp`：通过，已无大图 size warning 与 no async chunks warning。
- `pnpm release:check`：通过；串行完成 lint、test、E2E 35/35、API build、Admin build、H5 build、WeApp build。
- focused admin E2E：`pnpm e2e --project=admin --grep "人员 BANNER 富文本"`、`pnpm e2e --project=admin --grep "表单本地上传"`、`pnpm e2e --project=admin --grep "资源库上传"` 均通过。
- focused miniapp E2E：`pnpm e2e --project=miniapp-h5 --grep "人员 BANNER 富文本详情"` 与 `pnpm e2e --project=miniapp-h5 --grep "人员单富文本详情"` 均通过。
- focused admin unit：`pnpm --filter admin exec vitest run src/detail-pages/RichTextEditorField.test.tsx src/detail-pages/DetailPageConfigFields.test.tsx` 2 files / 15 tests passed。
- WeChat dist inspection：`apps/miniapp/dist` 为 `3.1M`，包含 `app.json`、`pages/artists/detail.*`、`pages/cases/detail.*`、`assets/generated/*` 等微信端产物。
- 禁用业务动作搜索：详情生产源码对 `favorite/share/consult/booking/fixed-bottom/business-action/action-spacer/action-bar/收藏/分享/咨询/预约/立即预约/在线咨询` 无命中；仅单测断言字符串命中。
- 重复实现搜索：sanitizer/service/editor/renderer 均集中在 `packages/shared/src/detail-pages.ts`、`apps/api/src/detail-pages/*`、`apps/admin/src/detail-pages/*`、`apps/miniapp/src/components/detail-page/*`。

## 视觉证据

- `docs/design/actual-artist-banner-rich-text.png`：`854×1844`，SHA-256 `0f2c86d7f67d9ebea9e1451ab0d4c6aedc014663602c4c68ab4d97d5d66455ff`。
- `docs/design/actual-artist-rich-text.png`：`854×1844`，SHA-256 `74acb9af17d43a559471124d5afb074cc79d6047722bc859465bdff333bb1dd4`。
- `docs/design/actual-case-banner-rich-text.png`：`854×1844`，SHA-256 `568c530968ca31804a34128e15fc3e3992b209f7e543b744c5e9984ddc26ee17`。
- `docs/design/actual-case-rich-text.png`：`854×1844`，SHA-256 `d60c0b08d09befa5e03bd6edadb371004e702d2942ae3b7d7447fa74fa1c64f0`。
- `docs/design/overlay-artist-detail.png`：`854×1665`，SHA-256 `dcd2b9ba5fd97f892a30154964d547ce1f4b5247557d4d290b7af9db6a97a121`。
- `docs/design/diff-artist-detail.png`：`854×1665`，SHA-256 `ce09fa76ed41067c6b96a7444a95d0b30098ac8737d9a7c2bae405a2d49f50a5`。
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

- 无代码/验证待完成项；最终回复需按源规格第 44 节输出 26 段结构化实施报告。

## 已知取舍

- 旧数据库字段只读保留；新保存不双写，兼容响应从 DetailPageConfig 派生。
- blocks 始终从已清洗 HTML 派生，不写数据库。
- SQLite 多态 owner 无真实外键，通过公共服务和孤儿审计保证一致性。
