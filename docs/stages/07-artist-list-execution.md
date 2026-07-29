# 07 演职人员统一列表页执行记录

## 执行目标

完成一个由可选人员分类驱动的统一演职人员列表页。当前规范入口为单一 `artist` 菜单：菜单可通过 `configJson.category` 进入指定中文分类，未配置分类时展示全部启用人员；旧 `host`、`singer`、`actor` 仅作为兼容别名映射到主持人、歌手和演员。交付必须同时包含：安全兼容的 SQLite 数据升级、媒体库注册的示例封面、18 条可重复 seed 数据、后台维护字段、Taro H5/微信端页面、API/后台/小程序自动化测试、H5 实际截图及差异图、接口与设计文档。

最终路由固定为：

- `/pages/artists/list`：全部启用人员
- `/pages/artists/list?category=<人员分类>`：按任意合法人员分类筛选
- `/pages/artists/list?type=host|singer|actor`：历史兼容深链，分别映射到 `主持人`、`歌手`、`演员`

小程序页面接收到缺失、空值或非法配置时降级为全部人员；API 的 `category` 省略时返回全部启用人员，旧 `type` 参数只承担兼容映射。

三种人员列表均为子页面，不渲染页面级底部菜单；返回入口仍通过顶部返回按钮安全回到分类或上一页。

## 范围与拆分

| 分项 | 责任文件/目录 | 交付条件 | 当前状态 |
| --- | --- | --- | --- |
| 共享契约 | `packages/shared/src/index.ts` | 中文类型映射、DTO、请求查询校验、标签解析/一次序列化 | 已实施并通过单测/构建 |
| 数据库与 API | `apps/api/prisma`、`apps/api/src`、`apps/api/test` | `location`/`badge` 迁移、序列化、筛选、18 条 seed、API 覆盖 | 已实施并通过 API 单测/构建 |
| 后台 CMS | `apps/admin/src`、`tests/e2e/admin.spec.ts` | 封面、地点、徽章、标签、描述字段及即时列表刷新 | 已实施，已通过 E2E |
| 小程序 | `apps/miniapp/src`、`tests/e2e/miniapp-h5.spec.ts` | 统一列表、搜索、筛选、卡片、子页面返回和入口 | 已实施，已通过 H5/微信构建和 E2E |
| 资源与设计 | `scripts`、`docs/design`、`assets/generated` | 可重复切图、资源清单、设计令牌、截图/diff | 已完成并已实际重生成/复核 |
| 集成验证 | 根脚本与本文件 | lint/test/e2e/build/release 证据和风险说明 | 已完成，见以下记录 |

## 实现约束

- 数据表保留 `avatarAssetId`；业务名称为“列表封面图”。新增 `location TEXT NOT NULL DEFAULT ''`、`badge TEXT NOT NULL DEFAULT ''`。
- 每次启动以 `PRAGMA table_info(artists)` 检查列；缺失时才执行 `ALTER TABLE ... ADD COLUMN`。不得丢失旧行或媒体关联。
- 客户端人员项只消费 `coverUrl`、`avatarUrl`、`location`、`badge`、`tags` 等序列化字段；`tags` 始终是 `string[]`。
- 标签在边界统一 trim、去空、去重、限 0–4 个；缺省规范化为 `[]`，存库只通过一次标签序列化函数写入 `tagsJson`。描述缺省或纯空白规范化为 `""`。
- 单个标签最长 12 个字符；共享层和后台 API 同时拒绝超长标签。
- 列表固定按 `sortOrder ASC, id ASC`；仅返回 `enabled`。`category` 为空时返回全部人员，非空时按人员分类精确过滤；`q` 搜索姓名、分类、地点、徽章、标签和描述；`location` 与 `tag` 是精确实际值筛选。
- 设计宽度为 `750rpx`。双列瀑布每列 `345rpx` 宽、`20rpx` 列间距、封面 `345rpx × 240rpx`、同列间距 `18rpx`。卡片按标签和描述是否存在自适应高度，描述最多两行，正文底部保留 `16rpx` padding。
- 所有文字都是实时 UI；封面资源仅包含照片。不得以整页或整卡片截图代替组件。

## 资源执行清单

参考图路径：`docs/design/reference-artists.png`（`853 × 1844`）。

运行：

```bash
pnpm assets:slice:artists
```

应稳定产出：

- `apps/miniapp/src/assets/generated/artist-cover-01.png` 至 `artist-cover-06.png`（均 `690 × 480`）
- `docs/design/artist-assets-manifest.json`

切图需要实查并去除参考图已有的左上角标签；页面再用不透明的动态标签渲染。

## 验证矩阵

| 验证 | 证明内容 | 命令或产物 |
| --- | --- | --- |
| 标签/契约单测 | 类型映射、标签恢复、非法输入 | `pnpm --filter @event-arts/shared test` |
| API 单测 | 创建、字段校验、筛选、排序、损坏 JSON、历史 SQLite 升级与幂等 | `pnpm --filter api test` |
| 后台 E2E | 新字段、必填、标签上限、保存/列表/编辑回填 | `pnpm e2e --grep '人员管理'` |
| 小程序 E2E | 单一人员入口、可选分类、旧深链兼容、双列稳定、搜索、筛选、详情、无页面级底栏 | `pnpm e2e --grep '人员'` |
| 资源 | 参考尺寸、裁切边界、输出尺寸 | `pnpm assets:slice:artists` |
| 构建 | 类型/打包/微信端 | `pnpm lint && pnpm test && pnpm e2e && pnpm build:api && pnpm build:admin && pnpm build:h5 && pnpm build:weapp` |
| 发布集合 | 全部真实命令串联 | `pnpm release:check` |

## 视觉复核步骤

1. 使用 Playwright 的移动视口打开 `artist` 人员入口或带 `category` 的深链。
2. 保存 `docs/design/actual-artists-host.png` 作为当前统一人员列表截图。
3. 以 `reference-artists.png` 与当前截图生成 `docs/design/diff-artists-host.png`；只可遮罩状态栏与平台胶囊，不能遮罩搜索或卡片。
4. 人工复核双列左右边界、封面高度、姓名基线、标签高度、两行描述和子页面安全区留白；至少完成一次调整与二次截图。

## 已记录执行证据

- `pnpm assets:slice:artists`：退出码 `0`，实际重生成 6 张 `690 × 480` 封面和资源清单。
- `pnpm db:push`、`pnpm db:seed`：退出码均为 `0`；seed 重新执行不新增重复人员记录。
- `pnpm lint`：退出码 `0`。
- `pnpm test`：退出码 `0`；Shared `8`、API `41`、Admin `3` 个 Vitest 用例全部通过，Miniapp package 没有本地 Vitest 文件。
- `pnpm e2e`：退出码 `0`，28 项 Playwright 用例全部通过；其中覆盖后台人员新增/编辑回填、三类入口、搜索、筛选、详情、无页面级底栏和截图/diff。2026-07-18 人员菜单合并后，小程序入口验收改为覆盖单一 `artist` 菜单、未配置分类的全部列表、任意中文分类、旧 `type` 深链兼容和非法配置降级。
- `pnpm --filter api build`、`pnpm --filter admin build`：退出码均为 `0`。后续已配置 Admin chunk warning budget，当前无 warning 输出。
- `pnpm --filter miniapp build:h5`、`pnpm build:weapp`：退出码均为 `0`。后续已压缩生成资源并配置 Taro performance budget，当前无 warning 输出。
- `pnpm release:check`：退出码 `0`，依次执行 lint、unit、E2E、API/Admin/H5/微信构建。
- 为兼容首次切出的旧截图资源，动态徽标已改为完整覆盖该资源中旧徽标的投影范围，且背景不透明；不会把旧标签文字透到实时徽标下方。
- 微信构建曾因页面运行时导入共享 TypeScript 源码而报 `ModuleParseError`；根因确认后将小程序改为仅导入共享类型、在页面定义等价的只读文案映射，随后微信构建退出码为 `0`。
- H5 视觉复核命令 `pnpm e2e --grep '人员列表设计复核截图与参考差异图'`：退出码 `0`；旧版本产生 host、singer、actor 截图和 host diff。人员菜单合并后，该用例改为截取当前统一人员列表根节点并继续生成 `actual-artists-host.png` 与 `diff-artists-host.png`。

## 完成门槛

只有所有分项均改为“完成”、上述验证命令有新鲜的退出码 `0` 证据、统一人员列表截图和 diff 文件真实存在，并且没有未解决的视觉或平台兼容风险时，才可将本阶段标记完成。

## 2026-07-18 人员菜单合并验证补充

- `pnpm lint`：退出码 `0`。
- `pnpm test`：退出码 `0`；shared `44`、miniapp `64`、API `228`、admin `140`、deploy `8`、build-script `4` 全部通过。
- `pnpm build:weapp`：退出码 `0`，Webpack 编译和 bundle budget 均通过。
- 聚焦 Playwright 两组各 `5` 项均通过，覆盖人员菜单未配置分类时显示全部、任意中文分类、旧 `host/singer/actor` 深链、分类页复用、人员卡片和后台相关回归。
- 全量 `pnpm e2e` 在批准沙箱外启动服务后连续通过 `49/62`，随后被外部 `SIGTERM` 终止（退出码 `143`）；终止前本次新增场景全部通过，无断言失败，剩余 `13` 项未执行。因此本次不把全量 E2E 记录为完整通过。
- `__ALL_ARTICLES__` 已确认只用于文章菜单后台 UI 的“全部文章”适配；文章与活动案例保存请求都会移除该哨兵，活动案例分类控件只消费 `/api/admin/case-categories`。

## 2026-07-29 左上标签自适应宽度

- 移除人员封面左上标签的固定最小宽度，改为内容收缩宽度、固定横向内边距和封面内最大宽度。
- 皇冠保持固定宽度；短标签自然变窄，长标签只在触及卡片边界时单行省略。
- H5 E2E 增加短/长标签实际宽度比较及不越出封面边界的几何断言。
- 聚焦标签宽度 Playwright 用例通过；最终全量 `pnpm e2e` 通过 `68/68`，人员列表设计复核截图与差异图在同次运行中刷新。
- 最终 `pnpm lint`、`pnpm test`、`pnpm build:weapp` 和 `git diff --check` 均通过。

## 2026-07-29 可选内容与瀑布流补充

- 后台下方标签和人员描述改为可选；创建缺省规范化为 `tags: []`、`summary: ""`，更新省略保持原值、显式空值执行清空，数据库与 DTO 结构不变。
- 前台仅在有效内容存在时创建标签和描述节点，列表最多展示前三个标签。
- 固定等高网格改为两个 Taro `View` 纵向列；纯函数根据卡片内容高度权重将数据确定性分配到当前较短列，不依赖 DOM 测量或实验性 CSS masonry。
- 卡片和正文区取消固定高度，最后一个可见正文元素后保留 `16rpx` 底部 padding；骨架复用相同双列宽度与间距。
- 聚焦 Shared、API、Admin 和 Miniapp Vitest 分别通过 `18`、`55`、`11`、`2` 项；聚焦 Playwright `4/4` 通过。
- `pnpm lint`、`pnpm build:weapp` 均退出码 `0`；完整 `pnpm e2e` 通过 `69/69`，并刷新人员列表和详情页视觉证据。
- 最终完整 `pnpm test` 退出码 `0`：Shared `56`、Miniapp `72`、API `266`、Admin `167`、deploy `9`、build-script `4` 全部通过。提交前一次运行曾遇到 SQLite `database is locked`，API 全量隔离重跑 `266/266` 后，完整命令再次执行通过。
