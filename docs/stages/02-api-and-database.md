# Stage 2 - API and Database

## 阶段目标
实现 Prisma 数据库、Fastify API、认证、CMS CRUD、上传校验、PV 统计和 API 测试。

## 功能范围
用户指定的 client/admin 接口与数据表。

## 主要文件
`apps/api`、`apps/api/prisma/schema.prisma`。

## 数据结构或接口
详见 `docs/api/index.md`。

## 测试方式
`pnpm --filter api test`、`pnpm test`、`pnpm --filter api build`、`pnpm --filter api db:push`、`pnpm --filter api db:seed`。

## 验收清单
- [x] API 统一响应
- [x] 上传真实元数据后端校验
- [x] 引用资源不可删除
- [x] 首页聚合过滤 disabled 数据
- [x] PV 统计返回今日、本周、本月
- [x] 图片/MP4 服务端真实格式、尺寸与 MD5 校验
- [x] MD5 并发去重、全局资源名唯一和标签筛选
- [x] 案例详情媒体有序关联、统一引用统计和批量清理
- [x] EdgeOne `SystemConfig` 单例、AES-256-GCM 凭证密文和生产主密钥启动门禁
- [x] DescribePlans/DescribeBillingData 可注入 SDK、套餐周期、地区折算和 Dashboard 局部故障隔离

## 已完成事项
- 已实现 `apps/api` Fastify app factory、server entry、JWT 管理员鉴权、统一响应和错误封装。
- 已实现 Prisma schema，覆盖统一资源标签、案例有序媒体关联、文章模块与稳定 seed 身份记录，以及 `admin_users`、`site_config`、`media_assets`、`announcements`、`banners`、`menu_items`、`artists`、`activity_cases`、`articles`、`page_view_events`、`operation_logs`。
- 已实现 SQLite bootstrap helper、内容寻址 seed 资源和稳定业务 seed 身份；seed 只负责默认站点配置、公告、文章菜单、文章示例、菜单、三条精选案例和三类人员的可重复初始化，不再创建或覆盖管理员。首个管理员通过显式 `admin:bootstrap` 初始化。
- 已实现用途无关的统一媒体库：流式临时文件、服务端 MD5、Sharp 图片探测、ffprobe MP4 探测、随机存储名、标签和全局唯一资源名。
- 已实现共享 `MediaFieldKey` 规则，所有业务保存接口重新验证资源存在性、类型和可解析元数据；尺寸作为后台推荐值展示，不作为图片硬限制。案例详情改用 `ActivityCaseMedia` 有序关联。
- 已实现资源查询/详情/标签/MD5 查询/名称检查/元数据编辑/未使用扫描/批量删除接口，并在删除前重新统计全部引用，包含文章封面 `article_cover`。
- 已实现旧 SQLite 幂等迁移预检：从真实文件回填 MD5、大小和尺寸，合并重复内容并迁移引用；文件缺失或非空旧 `mediaJson` 会在写库前终止。
- 已实现 client home/detail/list/articles/page-view 接口和 admin dashboard/site-config/media/articles/CRUD 接口。
- 分类菜单公共契约现有 7 种类型；`detail_page` 使用严格 `{ detailPageType, detailPageId }` JSON 配置。API 保存时校验目标存在及真实类型，损坏配置安全降级，并将菜单纳入详情页反向引用、引用计数和删除保护；不新增数据库列或默认 seed 菜单。
- API Vitest 使用 Fastify `app.inject()` 覆盖图片/MP4、真实 MIME、MD5 不一致、并发去重、名称标准化、标签筛选、元数据编辑、案例顺序、引用保护、清理和旧库迁移失败原子性。
- 新增独立 `system_config`，不复用客户端 `site_config`。SecretId/SecretKey 分字段使用随机 12 字节 IV 的 AES-256-GCM 密文封套、字段 AAD 和认证标签；生产主密钥缺失或非法时启动失败，开发/测试缺失时禁止保存。
- 新增服务端官方 EdgeOne Node.js SDK adapter、候选配置写前验证、`GET|PUT /api/admin/system-config/edgeone` 和 Dashboard `edgeOne` 联合状态。自动化只使用可注入 fake，不访问腾讯云或真实 CAM。
- 近 24 小时为 `acc_flux+smt_flux` 与 `sec_request_clean`；套餐流量按地区系数折算，流量/请求分母严格只取 `SecTrafficCapacity`/`SecRequestCapacity`。预付费按 `EnabledTime` 订阅月，下月无同日时按官方规则补齐 31 天；企业后付费按北京时间自然月，未知数据失败关闭。
- SQLite 全量备份自动包含 `system_config` 密文；备份测试确认明文不在快照中、原主密钥可解密、错误主密钥无法认证，并把该表纳入导入预检行数影响摘要。
- 验证通过：`pnpm lint`、`pnpm test`、`pnpm --filter api build`、`pnpm --filter api db:push`、`pnpm --filter api db:seed`。

## 对应 git commit hash
c988312

## 2026-07-15 上传图片客户端缓存验证

- `/uploads/` 静态资源按真实文件路径判断扩展名：`.jpg`、`.png`、`.webp`（大小写不敏感）返回 `Cache-Control: public, max-age=2592000, immutable`。
- 非图片资源保留原有 `Cache-Control: public, max-age=0`；ETag、Last-Modified、Accept-Ranges 和静态文件读取行为保持不变。
- 长缓存依赖随机、不可原地覆盖的上传文件名；本次未引入客户端 `downloadFile`/`saveFile` 缓存，也未改变对象存储或 CDN 策略。
- `app.inject()` 正向测试验证真实上传 PNG 的 30 天不可变缓存及文件字节，负向测试验证 MP4 不获得图片缓存策略。
- `pnpm --filter api test` 通过：19 个文件、169 个测试；`pnpm --filter api build` 与根 `pnpm test` 均通过。

## 已知问题或设计取舍
本地 SQLite；生产可迁移到托管数据库和对象存储。旧 `media_assets.usage` 与 `activity_cases.mediaJson` 仅保留为内部 legacy 列，新业务不再读写用途或 JSON 媒体列表。生产迁移前必须同时备份数据库与 `uploads`；EdgeOne 配置恢复还必须从数据库之外恢复原 `EDGEONE_CREDENTIAL_ENCRYPTION_KEY`。当前环境中 `prisma db push` 的 schema engine 对 SQLite 返回 `Schema engine error: undefined`，因此项目保留 Prisma schema 和 Prisma Client，同时使用 `apps/api/src/sqlite-schema.ts` 作为可重复执行的 SQLite bootstrap。真实腾讯云套餐、CAM 和数据延迟只在部署后人工烟测，不进入自动化。
