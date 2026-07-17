# 09 Security Hardening And Release Gate

## 目标

完成生产上线前的 P0/P1 安全加固闭环：禁止破坏性生产 seed，移除默认管理员和固定密码，强制加载 `.env` 并拒绝默认 JWT，增加登录和客户端用户统计限流，缩短 token 并实现服务器端撤销，避免直接暴露 Fastify 端口，补齐统计治理、严格 CORS、安全日志和后台备份/还原能力。

## P0 状态

- 生产 `db:seed`：`apps/api/src/seed.ts` 在 `NODE_ENV=production` 时写入前失败；seed 不创建、覆盖或删除管理员。
- 首个管理员：通过 `admin:bootstrap --password-stdin` 显式创建；不再提供默认管理员和固定密码。
- 密码轮换：后台提供修改密码入口；修改成功后撤销该管理员所有服务器端 session。
- 环境变量：API/Admin server build 和 runtime 读取仓库 `.env`；生产默认/弱 JWT 启动即失败。
- EdgeOne 主密钥：生产 `EDGEONE_CREDENTIAL_ENCRYPTION_KEY` 必须为规范 Base64 编码的 32 字节随机值，缺失或非法时 API 启动失败；开发/测试缺失时禁止保存 EdgeOne 配置。
- 限流：登录接口按 IP + 用户名限制失败次数；客户端用户统计接口按 IP 限制请求频率。
- token/session：管理员 JWT 有效期 2 小时，受保护接口校验服务器端 `jti` session；登出、改密和恢复会撤销 session。
- 小程序客户端访问边界：R1/G13 已实现 `POST /api/client/auth/wechat` 登录交换、微信 `jscode2session` 服务端 adapter、注入式 fake verifier、客户端会话 hash 存储/过期/撤销和 `/api/client/**` 统一鉴权 hook。R1/G14 已实现 miniapp 请求层 `Taro.login`/`wx.login` code 交换、短期 token 存储、客户端 API bearer 注入、并发登录单飞、401 单次重登重试和 H5 生产绕过禁用测试；G15 补齐 H5 dev/test adapter 与 E2E fake verifier，使本地 H5 调试仍走服务端登录交换。
- Fastify 端口：默认只绑定 `127.0.0.1`，Nginx 模板仅暴露 HTTPS 反向代理入口；公网端口不可达性仍需目标环境验证。

## P1 状态

- 统计治理：统计身份只来自有效客户端会话中的 `appId + openidHash`；同一微信用户在同一北京时间自然日仅计一次，数据库复合唯一约束与原子 upsert 保证并发幂等。新统计不保存原始微信身份、code、token、IP 或 User-Agent；旧匿名事件不回填、不参与新指标。`PAGE_VIEW_RETENTION_DAYS` 继续控制新旧统计数据保留期，并提供 `analytics:cleanup`。
- CORS：API 使用 `CORS_ALLOWED_ORIGINS` 显式白名单，拒绝未知、畸形或通配 origin。
- 错误和日志：未知 5xx 返回通用错误和 `requestId`；结构化日志脱敏 Authorization、Cookie、密码、归档、备份内容和 secret。
- EdgeOne 凭证：SecretId/SecretKey 在独立单例中分字段 AES-256-GCM 加密；SecretKey 不进入响应、URL、浏览器存储、日志、错误、操作记录或快照。候选配置验证失败不会覆盖旧密文。
- 微信登录敏感字段：AppSecret、微信登录 code、`session_key`、openid/unionid 和 token 原文均不得进入文档示例、错误响应或结构化日志。G12 已扩展集中日志脱敏字段；G13 实现 verifier 时必须继续使用该路径。
- 备份/还原：后台支持创建备份、查看列表、删除、导入 `.tar`/`.tar.gz` 外部备份、预检和 `RESTORE_FULL_BACKUP` 二次确认恢复；成功恢复会撤销所有管理员 session。
- 发布门禁：新增 `pnpm security:release-gate`，并把它作为 `pnpm release:check` 第一项；G15 已把微信小程序客户端认证配置、服务端鉴权 hook、`client_sessions` 表、shared 契约、miniapp 请求层和部署文档标记纳入门禁。任一自动化 P0/P1 门禁失败均禁止发布。

## EdgeOne CAM 与凭证恢复契约

- v1 仅支持一个 Zone 和一组 CAM 子账号凭证；不包含预热、配置修改、多 Zone 或全量 EdgeOne 管理。
- CAM 最小权限是 `teo:DescribePlans` 对 `*`，以及 `teo:DescribeBillingData` 对 `qcs::teo::uin/<主账号UIN>:zone/<ZoneId>`。最终资源表达式以腾讯云 CAM 文档为准。
- 保存前先验证唯一有效套餐，再验证 `acc_flux`、`smt_flux`、`sec_request_clean` 查询；全部成功后才原子写入配置密文和不含凭证的操作记录。
- `PayMode=1` 为预付费、`PayMode=0` 为后付费；预付费周期按 `EnabledTime` 的月序号锚定，下月不存在同一日期时按官方规则补齐 31 天，企业后付费仅接受企业套餐并按北京时间自然月。
- 数据库备份只包含密文，不包含主密钥。恢复必须同时从独立 secret 管理恢复原主密钥；错误密钥会因 GCM 认证失败而拒绝解密。
- 主密钥丢失后旧凭证不可恢复，且 v1 不做在线主密钥轮换。恢复流程是停 API、保留故障数据库副本、在离线维护窗口删除 `system_config` 单例、设置新主密钥、重启并通过系统配置页重新录入 CAM。不得尝试导出或绕过认证读取旧密文。
- 自动化使用 fake SDK 和运行期构造的测试值；真实 CAM、Zone、套餐响应与约 3 小时计费延迟只在部署后人工烟测。

## R1 小程序客户端访问控制契约

生产 `/api/client/**` 的保护边界是后端签发的短期客户端会话，不是 CORS、`Origin`、`Referer`、`User-Agent`、自定义 Header 或 IP 白名单。唯一无客户端会话例外是 `POST /api/client/auth/wechat`，该接口接收小程序 `wx.login` 临时 code，由服务端通过目标 AppID 的 `code2Session` 校验后签发 opaque Bearer token；`session_key` 不返回前端，不作为 token。

G12 新增生产配置门禁：

| 环境变量 | 生产要求 |
| --- | --- |
| `WECHAT_MINIAPP_APP_ID` | 必填；缺失、占位或非微信小程序 AppID 格式时启动失败 |
| `WECHAT_MINIAPP_APP_SECRET` | 必填；缺失或占位时启动失败；不得提交到源码 |
| `WECHAT_AUTH_VERIFIER_MODE` | 生产必须为 `wechat`；`fake` 只允许 dev/test |
| `CLIENT_SESSION_TTL_SECONDS` | 默认 1800 秒，范围 60-86400 秒 |
| `WECHAT_CODE2SESSION_TIMEOUT_MS` | 默认 3000 ms，范围 500-30000 ms |

G13 已在 API 侧实现：

- `POST /api/client/auth/wechat` 是唯一不需要客户端会话的 `/api/client/**` 例外；其他客户端 API 缺 token、未知 token、管理员 JWT、过期或撤销 client token 均返回 401。
- 生产 verifier 使用服务端 AppID/AppSecret 调用已知微信 `jscode2session` URL；自动化只用 fake fetch/fake verifier 覆盖 adapter 行为，不访问真实微信网络，不使用真实 AppSecret。
- `client_sessions` 只保存 opaque token 的 SHA-256 hash、AppID、`openidHash`、`unionidHash`、过期和撤销字段，不保存 raw token、微信 code、`session_key`、openid 或 unionid。
- 登录交换复用应用层固定窗口限流；超时映射为 `504/WECHAT_AUTH_UNAVAILABLE`，上游/配置不可用映射为 `502/WECHAT_AUTH_UNAVAILABLE`，无效 code 或 AppID 不匹配映射为 `401/INVALID_WECHAT_CODE`。
- 手写 SQLite bootstrap 已创建 `client_sessions` 表和索引；Prisma schema 已增加 `ClientSession` 模型。既有 SQLite 环境执行 `pnpm --filter api db:push` 会通过 bootstrap 创建缺失表。

每日用户统计沿用该可信客户端会话边界：

- `POST /api/client/track/page-view` 保留原请求体和成功信封，但 `pagePath`、`scene` 不参与身份或去重。
- 服务端只使用会话中的 `appId + openidHash` 写入 `daily_user_visits`，唯一键为 `appId + openidHash + visitDate`；`visitDate` 是 `Asia/Shanghai` 的 `YYYY-MM-DD`。
- 今日指标为当天去重用户数；本周从周一开始、本月从每月 1 日开始，周/月指标均为区间内每日去重记录数之和。
- 原始 openid/unionid、微信 code、token、IP 和 User-Agent 不写入统计表、统计响应或该统计路由日志。
- 旧 `page_view_events` 只保留兼容清理，不回填、不混入新指标；备份、恢复、测试重置和保留期清理均包含新表。

G14 已在 miniapp 请求层实现：

- 受保护 `/api/client/**` 请求在发送前自动获取客户端会话并附加 `Authorization: Bearer <client-token>`；`POST /api/client/auth/wechat` 登录交换自身不附加客户端 bearer。
- 小程序运行时使用 `Taro.login`，必要时回退 `wx.login` 获取临时 code，再调用服务端登录交换；H5 仅允许通过显式 dev/test adapter 提供确定性 code，`NODE_ENV=production` 时禁用该 adapter。
- H5 dev/test 启动时会在非生产 WEB 环境配置确定性 login-code adapter，仍需 API 侧 fake verifier 完成服务端登录交换；生产构建不会允许该 adapter 作为绕过。
- 客户端只保存短期 opaque token、token type 和过期时间；不保存 AppSecret、`session_key`、openid/unionid 或静态绕过密钥。
- 多个并发受保护请求共享同一次登录交换；客户端会话 401 会清理本地 token，强制重新登录并最多重试原请求一次，避免无限循环。
- `requestWithTask` 保留 abort 接口；认证完成前取消会阻止后续业务请求，业务请求已发出时继续调用底层 request task 的 `abort`。

## 文档更新

- `README.md`：补齐 bootstrap、seed 禁止、release gate、部署前验证、备份/恢复和人工未覆盖项。
- `.env.example`、`README.md`：补齐 EdgeOne 主密钥生成、先配密钥再发代码、最小 CAM、数据口径、备份恢复和主密钥丢失恢复路径。
- `docs/api/index.md`：补齐 Auth、密码修改、session 撤销、限流、统计治理、安全日志和备份恢复 API。
- `docs/api/index.md`：补齐 EdgeOne 配置接口、Dashboard 联合状态、错误码、计费口径和 `no-store` 契约。
- `docs/deploy/nginx-production-routing.md`：补齐 loopback 反代、`deploy:smoke`、`security:release-gate`、`nginx -t`、备份恢复、回滚和灾难演练。
- `docs/deploy/nginx-production-routing.md`：补齐微信小程序生产变量、匿名 `/api/client/home` 应返回 `401/CLIENT_AUTH_REQUIRED`、真实 `wx.login -> /api/client/auth/wechat -> /api/client/home` 验证步骤。
- `docs/stages/06-weapp-build-and-deploy.md`：上线清单补入安全门禁、备份容量、异地备份、保留调度和灾难演练。

## G11 验证记录

以下命令在本轮 G11 最终验证阶段执行：

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 发布安全门禁 | `pnpm security:release-gate` | 通过，自动化 P0/P1 repository checks green，并列出目标环境人工检查项 |
| 部署脚本测试 | `pnpm test:deploy` | 通过，2 个文件 8 个测试 |
| Lint | `pnpm lint` | 通过 |
| Unit/contract tests | `pnpm test` | 通过；shared 29、miniapp 22、admin 79、api 152、deploy 8 个测试 |
| E2E | `pnpm e2e` | 通过；沙箱内因 `listen EPERM 127.0.0.1:3001` 失败，提升权限执行后 48 个测试通过，用时 2.9 分钟 |
| API build | `pnpm --filter api build` | 通过 |
| Admin build | `pnpm --filter admin build` | 通过；Vite 仍提示单 chunk 超 2000 kB，退出码 0 |
| Miniapp H5 build | `pnpm --filter miniapp build:h5` | 通过 |
| WeApp build | `pnpm build:weapp` | 通过 |
| 备份恢复一致性 | `pnpm --filter api exec vitest run test/restore.test.ts test/backup.test.ts --no-file-parallelism --maxWorkers=1` | 通过，2 个文件 12 个测试，覆盖临时 DB/uploads 的备份、修改和恢复一致性 |
| 生产 seed 拒绝 | 隔离 SQLite `NODE_ENV=production pnpm --filter api db:seed` | 通过；强 JWT 配置下写入前报错 `db:seed is disabled in production`，隔离 DB/uploads/backup 路径均未创建 |

## G11 验证修复记录

- `pnpm security:release-gate` 首次发现门禁脚本和负例测试自身包含完整默认密码/JWT 字面量；已改为运行时拼接，源码不再保留禁用值。
- `pnpm e2e` 首次提升运行发现严格 CORS 拦截 Admin/H5 本地 origin；已在 `playwright.config.ts` 的 API E2E 环境显式设置 `CORS_ALLOWED_ORIGINS`。
- `pnpm e2e` 第二次提升运行发现改密 E2E 污染后续项目使用的管理员密码；已在改密用例中验证撤销后恢复初始 E2E 密码。
- `pnpm e2e` 最终提升复跑通过，结果为 48 个 Playwright 测试通过。
- `pnpm test` 曾在 Admin jsdom/Tiptap/AntD 重型测试并发下超时和 teardown 后出现 React scheduler 未处理错误；已将 Admin Vitest 文件串行执行，并在 `DetailPageConfigFields.test.tsx` 中显式 cleanup 后等待 scheduler 队列。
- `git diff --check`：通过。

## G15 验证记录

以下命令在 R1/G15 最终验证阶段执行：

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 发布安全门禁 | `pnpm security:release-gate` | 通过；新增微信小程序客户端认证自动化标记检查，并列出目标环境人工检查项 |
| 部署 smoke | `pnpm deploy:smoke` | 通过；API/Admin host 与 Nginx upstream 均为 loopback |
| 部署脚本测试 | `pnpm test:deploy` | 通过，2 个文件 8 个测试 |
| R1 API 回归 | `pnpm --filter api test -- client-auth.test.ts api.test.ts security-logging.test.ts config.test.ts` | 通过，19 个文件 163 个测试 |
| Shared 契约回归 | `pnpm --filter @event-arts/shared test -- contracts.test.ts` | 通过，2 个文件 30 个测试 |
| Miniapp 请求层回归 | `pnpm --filter miniapp test -- api.test.ts` | 通过，5 个文件 26 个测试 |
| Lint | `pnpm lint` | 通过 |
| Unit/contract tests | `pnpm test` | 通过；shared 30、miniapp 26、api 163、admin 79、deploy 8 个测试 |
| API build | `pnpm --filter api build` | 通过 |
| Admin build | `pnpm --filter admin build` | 通过；Vite 仍提示单 chunk 超 2000 kB，退出码 0 |
| Miniapp H5 build | `pnpm --filter miniapp build:h5` | 通过 |
| WeApp build | `pnpm build:weapp` | 通过 |
| E2E | `pnpm e2e` | 沙箱内因 `listen EPERM 127.0.0.1:3001` 失败；提升权限复跑通过，48 个测试通过，用时 4.1 分钟 |
| H5 产物敏感标记扫描 | `rg "h5-dev-code|fake-session-key|WECHAT_MINIAPP_APP_SECRET|yourwechat|yourappsecret|appSecret|session_key" apps/miniapp/dist` | 无命中；`rg` 退出码 1 表示未找到 |
| 空白差异检查 | `git diff --check` | 通过 |

## G15 验证修复记录

- `pnpm e2e` 首次提升运行发现测试 helper 仍匿名请求 `/api/client/**`，后端正确返回 `CLIENT_AUTH_REQUIRED`；已改为先调用 `/api/client/auth/wechat` 获取 client bearer，并在会话 401 时刷新一次。
- H5 页面侧首次接入真实页面流时需要 dev/test login-code adapter；已在 `apps/miniapp/src/app.tsx` 中只对非生产 WEB 环境配置 adapter，E2E API 环境显式使用 fake verifier 和测试 AppID。
- E2E 备份/恢复流程会在本地生成 `var/backups`，已将 `var/` 加入 `.gitignore`，并恢复被测试清理的 `uploads/.gitkeep`。

## 2026-07-17 EdgeOne 验证记录

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| EdgeOne 核心与 API | `pnpm --filter api exec vitest run test/edgeone-core.test.ts test/edgeone-api.test.ts --no-file-parallelism --maxWorkers=1` | 通过，2 个文件 24 个测试；包含全部地区系数、31 天月末补齐、周期边界、空数据、超额和容量字段防重复 |
| 备份与恢复 | `pnpm --filter api exec vitest run test/backup.test.ts test/restore.test.ts --no-file-parallelism --maxWorkers=1` | 通过，2 个文件 12 个测试；快照只含密文，原密钥可解密，错误密钥认证失败 |
| 计划内 TypeScript lint | `pnpm exec eslint apps/api/src apps/api/test apps/admin/src packages/shared/src packages/shared/test tests/e2e/admin.spec.ts playwright.config.ts` | 通过 |
| 仓库 Lint | `pnpm lint` | 未通过，唯一错误为既有小程序测试 `apps/miniapp/src/services/api.test.ts:84:10` 的未使用变量 `rateLimitedBody`；EdgeOne/Api/Admin/Shared/E2E 范围 lint 通过，本任务未越界修改小程序 |
| Unit/contract/integration | `pnpm test` | 通过；shared 36、miniapp 57、api 204、admin 98、deploy 8 个测试 |
| API build | `pnpm --filter api build` | 通过 |
| Admin build | `pnpm --filter admin build` | 通过；Vite 单 chunk 约 2025 kB 警告不影响退出码 |
| EdgeOne E2E | `pnpm e2e --project=admin --grep EdgeOne` | 通过，1 个场景；fake 响应覆盖安全配置、七卡刷新、防并发、凭证无浏览器残留和 4/2/1 响应式 |
| Admin E2E | `pnpm e2e --project=admin` 及失败项聚焦复跑 | 20 个后台场景均已覆盖通过；首次全量尝试暴露 AntD dialog 无可访问名称，改用可见 dialog 加标题文本定位后，文章场景 1/1 与末 5 个场景 5/5 通过 |
| 全量 E2E | `pnpm e2e` | 未通过：14 个场景通过后，既有 Admin dialog 选择器失败（随后已修复）及 Miniapp H5 首场景无法加载；当前剩余阻断是 H5 构建无法解析 `@babel/runtime/helpers/interopRequireWildcard`，39 个后续场景未执行 |
| Miniapp H5 诊断 | `env NODE_ENV=test pnpm --filter miniapp build:h5` | 未通过，缺少直接依赖 `@babel/runtime`；小程序是 EdgeOne v1 非目标且 G04 禁止修改 |

自动化仅使用可注入 fake EdgeOne 客户端或浏览器 route，不包含真实 SecretId/SecretKey。真实 CAM、目标 Zone、套餐返回值和部署日志/网络响应烟测仍须在部署后完成，因此本轮发布总门禁不标记为通过。

## 人工未验证项

本地自动化不能替代目标服务器和第三方平台检查；上线前必须在生产或 production-like 环境记录以下结果：

- TLS 证书、HSTS 和微信 request 合法域名。
- 真实微信小程序 `wx.login -> /api/client/auth/wechat -> /api/client/home` 链路，目标 AppID/AppSecret、request 合法域名和小程序包内 `TARO_APP_API_BASE_URL` 一致性。
- 防火墙/安全组只暴露 Nginx HTTPS，API/Admin Fastify 端口公网不可达。
- `analytics:cleanup` 和备份保留策略的调度器执行、失败告警和权限。
- `BACKUP_DIR` 容量、权限、保留周期、异地备份复制、RTO/RPO 指标。
- 灾难演练：创建备份、修改数据和 uploads、恢复、校验数据/uploads/session 撤销，并回滚到恢复点。
- 真实 CAM 最小策略、目标 Zone 授权、配置保存、四项用量、约 3 小时延迟、刷新时间变化，以及服务日志/浏览器响应无 SecretKey。
- EdgeOne 数据库恢复演练：同一主密钥恢复成功；主密钥丢失场景按离线删除单例并重新录入凭证，不声称可恢复旧明文。
