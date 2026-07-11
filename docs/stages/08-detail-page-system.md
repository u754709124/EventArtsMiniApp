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
- `tests/e2e/admin.spec.ts` 覆盖显式选择、BANNER 排序、图片/视频插入、预览、回填、双向切换和中文校验；真实运行仍受 `tsx` IPC sandbox 限制。

## 已完成：Taro 公共详情 renderer

- `DetailPageRenderer` 使用 shared `rendererKey` 注册表，未知 renderer 进入受控错误状态；人员和案例路由只负责取数、PV、状态分类和 Hero adapter。
- `BannerRichTextRenderer` 渲染排序 BANNER、页码、覆盖式导航、Hero 和内容重叠；单图不循环，多图正式环境慢速轮播，E2E 可固定第一帧。
- `RichTextRenderer` 及默认 route loading 均不创建 BANNER、Hero、页码、BANNER skeleton、保留高度或负重叠。
- 富文本图片会预检并提供失败重试/remount；BANNER 图片失败可见、使用占位图且可重试；视频使用独立 Taro `Video`，有 controls、无 autoplay/loop，可信尺寸按真实比例，非法尺寸回退 16:9。
- 请求切换使用 abort 和序列门控，切换 ID 立即清空旧数据；错误、配置缺失和媒体异常有明确 retry 或状态文案。提交为 `e4780a6`，review 修复为 `3b2d7c3`，Task 13 复审结论为 Approved。

## 已完成：Task 14 静态视觉文档与 E2E 草案

- `docs/design/detail-page-system.md` 已记录公共架构、接口契约、HTML/CSS 白名单、媒体生命周期、SQLite 迁移、Tiptap 选择、Taro renderer/adapters、参考资产、测量 token、平台差异、移除业务操作和新增第三种 renderer 的八步流程。
- `apps/miniapp/src/components/detail-page/detail-page.scss` 使用 `$detail-*` 变量承接参考图测量值，避免在组件内散落视觉常量。
- `tests/e2e/miniapp-h5.spec.ts` 已新增四种详情页行为断言、ID race、错误重试、四张截图和 overlay/diff/hash 生成逻辑，提交为 `06ab56c`；当前只能证明测试已被 Playwright 发现，真实执行仍受本地 `tsx` IPC 权限限制。
- README、API 文档和完整设计文档提交为 `c240aba`，补充公共详情契约、预览接口、seed 稳定示例、切图命令、媒体保护和视觉证据命令。

## 当前验证证据

- `pnpm --filter @event-arts/shared test`：2 files / 22 tests passed。
- `pnpm --filter @event-arts/shared build`：通过。
- `pnpm --filter api test`：9 files / 81 tests passed。
- `pnpm lint`：通过。
- 边界包分别验证：shared 22、admin 14、api 81；根 `pnpm test` 将在并发任务全部 GREEN 后重新运行并作为 Task 15 证据。
- `pnpm exec vitest run scripts/slice-artist-detail-assets.test.ts`：1 file / 1 test passed；测试内连续切片两次并逐文件比较 MD5。
- `pnpm --filter api exec vitest run test/detail-page-api.test.ts`：1 file / 8 tests passed；覆盖关系计数幂等、真实 BANNER、案例视频、单富文本媒体和明确缺文件错误。
- 实际运行 `pnpm assets:slice:artist-detail` 两次后比较 26 个资源和 4 个设计文件：`diff` 无输出。
- `ffprobe`：`detail-case-demo.mp4` 为 H.264、`16 × 16`、1 秒且无解析错误。
- `pnpm --filter admin test`：5 files / 14 tests passed（含失败媒体恢复和乱序请求隔离）。
- `pnpm --filter admin build`：通过；`pnpm lint`：通过。
- RichTextEditor focused：8/8 passed；结构、可信媒体映射、外部回填/reset、StrictMode 和无障碍均覆盖。
- `pnpm --filter admin exec vitest run src/detail-pages/DetailPageConfigFields.test.tsx src/detail-pages/DetailPagePreview.test.tsx src/artist-case-integration.test.tsx`：3 files / 14 tests passed（Task 11 提交后重跑）。
- `pnpm --filter admin build`：Task 11 提交后重跑通过；仅 Vite 大 chunk warning。
- `pnpm --filter miniapp exec vitest run src/components/detail-page/detail-page.test.ts`：1 file / 13 tests passed。
- `pnpm exec playwright test --list --project=miniapp-h5`：列出 23 个 miniapp H5 tests，其中包含 6 个公共详情行为/截图相关测试。
- `pnpm lint`：2026-07-11 再次通过。
- `pnpm --filter miniapp build:h5`：2026-07-11 再次通过；仅有既有 Webpack asset/entrypoint size warnings。
- Task 14 agent 报告 `pnpm test`、`pnpm build:weapp`、`git diff --check` 和 Sharp 50% alpha 合成验证通过；主线程尚未把这些作为最终 Task 15 证据。
- `pnpm exec playwright test --project=miniapp-h5 --grep "四种详情页视觉截图与人员详情对齐差异图"`：失败于 webServer 启动阶段，`tsx src/bootstrap-db.ts` 创建 `/var/folders/.../T/tsx-501/*.pipe` 时 `listen EPERM`。按 sandbox 规则申请外部执行后，自动审查因当前使用额度限制拒绝；未尝试间接规避。

## 迁移覆盖

- 新库重复初始化。
- 旧人员纯文本转义和换行段落。
- 旧案例图片/视频顺序和重复资源消除。
- 已有新配置不覆盖。
- 多次迁移不重复。
- 非空不可解释 `legacyMediaJson` 整体回滚。
- 迁移后无多态 owner 孤儿。

## 待完成

- Task 14 真实 H5 E2E 执行、四张详情截图、`overlay-artist-detail.png`、`diff-artist-detail.png` 和视觉证据 JSON。
- Admin/H5 E2E、全量发布验证、微信端构建产物检查和最终第 44 节报告。

## 已知取舍

- 旧数据库字段只读保留；新保存不双写，兼容响应从 DetailPageConfig 派生。
- blocks 始终从已清洗 HTML 派生，不写数据库。
- SQLite 多态 owner 无真实外键，通过公共服务和孤儿审计保证一致性。
