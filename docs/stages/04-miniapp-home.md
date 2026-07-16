# Stage 4 - Miniapp Home

## 阶段目标
实现 Taro 首页、基础路由、TabBar、接口状态和 H5/weapp 构建。

## 功能范围
首页 6 个模块、公告/案例/人员/联系/分类/我的基础页面。

## 主要文件
`apps/miniapp`。

## 数据结构或接口
`GET /api/client/home`、`GET /api/client/menu-items` 与详情列表接口。

## 测试方式
`pnpm --filter miniapp build:h5`、`pnpm build:weapp`、`pnpm lint`、`pnpm test`；H5 E2E 在 Stage 5 统一执行。

## 验收清单
- [x] 首页失败状态可重试
- [x] 空公告隐藏
- [x] 无 Banner 显示默认图
- [x] 图片失败显示占位图
- [x] 七类菜单跳转正确
- [x] 固定 TabBar 可用

## 已完成事项
- 已实现 Taro 4 + React + TypeScript + SCSS miniapp 包。
- 已配置首页、公告详情、案例列表/详情、人员列表/详情、联系我们、分类、我的页面。
- 已实现固定四项 TabBar：首页、分类、案例、我的。
- 首页调用 `GET /api/client/home`，成功后上报 `POST /api/client/track/page-view`。
- 首页实现顶部标题区、公告栏、Banner、菜单卡片、精选案例、失败重试状态、空状态和图片 fallback。
- 首页菜单只展示 `showOnHome=true` 的启用菜单；分类页调用 `GET /api/client/menu-items` 展示全部启用菜单。
- 菜单跳转规则严格对应 `host`、`singer`、`actor`、`activity_case`、`article`、`detail_page`、`contact`；文章菜单使用 `navigateTo` 打开 `/pages/articles/list` 并携带分类/pageSize query，`detail_page` 从配置读取正整数 ID 并直接进入 `/pages/detail/index?id=<id>`。
- 首页和分类页共用 `openMenu`；直达详情配置缺失或损坏时不发起导航。本能力不创建默认 seed 菜单，因此不改变首页默认菜单数量或视觉布局。
- 案例页支持顶部关键词搜索，按单列 710rpx 案例卡片展示，并复用首页精选案例的信息结构。
- 已完成首页视觉校准：H5 顶部安全区为 36px，微信端仍使用胶囊按钮位置；标题/副标题采用 36rpx/24rpx 明确行高，公告栏与 Banner 纵向节奏对齐参考图。
- 已将精选案例卡片的文字区固定为 224rpx，标题与简介限制为两行，封面改为块级元素以消除 H5 行内基线空隙；首卡 H5 实测高度为 219px。
- H5 和 weapp 构建均已成功。
- 验证通过：`pnpm --filter miniapp build:h5`、`pnpm build:weapp`、`pnpm lint`、`pnpm test`。

## 2026-07-15 详情页直达菜单验证

- 新增后台与 H5 聚焦 E2E 均通过：后台完成类型过滤、保存、回填与删除保护；H5 从首页和分类页均进入同一独立详情页，运行时创建的数据已清理。
- `pnpm test` 通过：shared 35、miniapp 37、API 168、admin 89、deploy 8 个测试全部通过。
- `pnpm --filter api build`、`pnpm --filter admin build`、`pnpm --filter miniapp build:h5`、`pnpm build:weapp` 均成功；WeApp `dist/pages/detail/index.js` 存在。
- 根 `pnpm lint` 未通过，原因是本功能范围外的既有 `apps/miniapp/src/services/api.test.ts:84` 定义了未使用变量 `rateLimitedBody`；本任务未修改该文件。
- 完整 `NODE_ENV=development pnpm e2e` 中，新增直达菜单用例与此前 37 个场景通过；随后既有“人员 BANNER 富文本详情使用公共 hero、轮播和覆盖布局”稳定失败，断言期望至少一个标题节点但得到 0。该用例单独复跑仍失败，涉及此前详情展示/seed 契约，不在本菜单 Goal 范围；其后的 13 个串行场景因此未执行。

## 对应 git commit hash
6dd9a7d

## 2026-07-15 下拉刷新与图片缓存联调验证

- 首页、分类、案例、文章、人员五个远端数据页已启用原生下拉刷新；刷新会等待真实接口请求，并在成功或失败后停止原生刷新动画。
- 后台刷新保留已有成功内容和当前筛选上下文；文章列表从第一页重新请求并替换累计数据。五页均使用最新请求保护，旧请求不会覆盖新结果。
- `pnpm --filter miniapp test` 通过：9 个文件、43 个测试；`pnpm --filter miniapp build:h5` 与 `pnpm build:weapp` 均通过。
- WeApp 构建产物中的首页、分类、案例、文章、人员五个页面 JSON 均包含 `enablePullDownRefresh: true`。
- 根 `pnpm test` 通过；根 `pnpm lint` 仍被本功能范围外的既有 `apps/miniapp/src/services/api.test.ts:84` 未使用变量 `rateLimitedBody` 阻塞。
- 完整 `NODE_ENV=development pnpm e2e` 首次在 sandbox 内因本地端口监听权限失败；授权后运行时，既有 Admin“新增 Banner”资源选择断言失败并触发后续串行用例停止。单独运行 Miniapp H5 项目时前 18 个场景通过，随后既有“人员 BANNER 富文本详情使用公共 hero、轮播和覆盖布局”仍因标题节点为 0 失败，其余 15 个场景未执行；该失败与本次刷新改动无关。

## 2026-07-15 下拉刷新顶部 loading 圈验证

- 首页、分类、案例、文章和人员列表在主动下拉刷新请求期间，于各自顶部内容区显示统一的棕金色旋转 loading 圈；请求成功或失败后组件立即卸载，不保留高度或空占位。
- 共享刷新 controller 防止活动请求期间重复下拉产生并行请求或提前隐藏；初次加载、手动重试和文章加载更多不显示该 loading 圈。
- `pnpm --filter miniapp test` 通过：9 个文件、47 个测试；新增覆盖 pending、成功、失败、重复触发、五页位置、可访问语义和公共动画样式。
- 聚焦 ESLint、`pnpm test`、`pnpm --filter miniapp build:h5` 与 `pnpm build:weapp` 通过。
- 根 `pnpm lint` 仍仅被本功能范围外的既有 `apps/miniapp/src/services/api.test.ts:84` 未使用变量 `rateLimitedBody` 阻塞。
- 完整 E2E 中 Admin 19 个场景及 Miniapp H5 前 18 个场景通过；随后仍停在既有“人员 BANNER 富文本详情使用公共 hero、轮播和覆盖布局”标题节点为 0 的断言，后续 15 个场景未执行。该详情富文本失败与本次顶部 loading 圈无交集。

## 2026-07-16 首页公告首次自动轮转验证

- 首页公告继续以自定义计时器作为唯一轮转时钟，`Swiper` 保持 `autoplay=false`；微信端先等待原生视图提交，并为 `nextTick`、节点查询和临时零尺寸分别增加一次性启动保护、有界超时/重试及安全降级，避免首次进入永久停在 `measuring`。
- 每轮测量通过公告索引、公告 ID 和递增 run ID 隔离；换公告、刷新或卸载会取消视图就绪、测量、跑马灯和切换计时资源。长文本仍按“起始停顿—完整横向滚动—结束停顿”计算总展示时长。
- `pnpm --filter miniapp test -- src/pages/index/announcement-timing.test.ts` 通过：9 个文件、57 个测试；聚焦 ESLint 与相关文件 `git diff --check` 通过。
- 公告最终聚焦 H5 E2E 通过 4/4：首次无手势从 0 切到 1 再回到 0、长公告、手动横向切换和单条静止均通过；此前包含“无公告时隐藏”的公告分组为 5/5 通过。`pnpm --filter miniapp build:h5` 与 `pnpm build:weapp` 均成功。
- 微信开发者工具 Stable `2.01.2510290`、模拟器基础库 `3.16.0` 使用本地临时 API、fake 微信登录和两条 3000ms 公告验收：终止后冷启动首页，全程不操作公告，首条完成跑马灯后自动切到第二条并继续回到首条；可见项与内部索引一致。横向滚动容器手动切换后仍继续自动计时，未触发 Planner revision 条件。
- 根 `pnpm lint` 仍仅被范围外既有 `apps/miniapp/src/services/api.test.ts:84` 未使用变量 `rateLimitedBody` 阻塞。最终根 `pnpm test` 中 shared 36、miniapp 57 通过，但工作区同期的 API 改动出现 SQLite 测试库无法打开以及 `security-logging` 缺少 `analytics_rate_limited` 事件，导致总命令失败；本次公告范围未修改这些 API 文件。
- 完整 E2E 已执行，37 个场景通过后仍停在既有“人员 BANNER 富文本详情使用公共 hero、轮播和覆盖布局”标题节点为 0 的断言，后续 15 个串行场景未执行；公告聚焦回归已单独全绿。

## 已知问题或设计取舍
参考图下方扩展模块不纳入一期交互范围。H5 截图不模拟微信状态栏和胶囊按钮，因此采用独立的 36px 顶部安全区；微信端保持运行时胶囊按钮适配。Taro 构建需要写入 `~/.taro4.0` 缓存目录，sandbox 内需授权运行。后续已将首页切图改为 palette PNG 并配置构建 performance budget，H5/weapp 当前构建无 warning 输出。
