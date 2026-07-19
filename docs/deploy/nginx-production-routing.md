# Nginx 生产反向代理部署

本方案使用 Nginx 作为唯一公网入口：

```text
HTTPS Client
  -> Nginx :443
     -> /admin/   -> Admin static service 127.0.0.1:4173
     -> /api/     -> Fastify API 127.0.0.1:3001
     -> /uploads/ -> Fastify API 127.0.0.1:3001
```

`/admin` 必须重定向到 `/admin/`。Admin 构建资源使用 `/admin/assets/...`，Browser Router 使用 `/admin` basename。API 路由和上传资源路径保持原样，Nginx 不剥离 `/api` 或 `/uploads`。

## 环境变量

生产 `.env` 至少配置：

```bash
API_PORT=3001
API_HOST=127.0.0.1
ADMIN_HOST=127.0.0.1
ADMIN_PORT=4173
JWT_SECRET=<replace-with-a-long-random-secret>
DATABASE_URL=file:./prod.db
UPLOAD_DIR=../../uploads
BACKUP_DIR=../../var/backups
MAX_IMAGE_UPLOAD_BYTES=10485760
MAX_VIDEO_UPLOAD_BYTES=104857600
PUBLIC_BASE_URL=https://your-domain.example
CORS_ALLOWED_ORIGINS=https://your-domain.example
CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN=true
WECHAT_MINIAPP_APP_ID=wx0000000000000000
WECHAT_MINIAPP_APP_SECRET=<replace-with-real-wechat-app-secret>
WECHAT_AUTH_VERIFIER_MODE=wechat
CLIENT_SESSION_TTL_SECONDS=1800
WECHAT_CODE2SESSION_TIMEOUT_MS=3000
VITE_API_BASE_URL=
TARO_APP_API_BASE_URL=<replace-with-real-wechat-api-https-origin>
```

关键约束：

- `PUBLIC_BASE_URL` 是真实公网 HTTPS origin，不要追加 `/api`。
- `CORS_ALLOWED_ORIGINS` 必须是显式 HTTPS origin 列表；生产不允许 `*`、任意 origin 反射或非 HTTPS origin。无 `Origin` 的服务端请求是否放行由 `CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN` 明确控制。
- 同源 Nginx 部署下 `VITE_API_BASE_URL` 留空或不注入，让 Admin 请求 `/api/...`。
- `API_HOST` 和 `ADMIN_HOST` 默认 `127.0.0.1`。`NODE_ENV=production` 时 API 与 Admin 会在监听端口前拒绝非 loopback host，包括 `0.0.0.0`、`::`、公网 IPv4/IPv6 和普通公网主机名。
- 禁止把 `API_HOST=0.0.0.0` 或 `ADMIN_HOST=0.0.0.0` 当作容器、反代或进程管理的部署捷径。容器、多主机或多实例部署会改变网络边界，必须先创建 Planner revision 重新定义架构与验证方式。
- `WECHAT_MINIAPP_APP_ID` 和 `WECHAT_MINIAPP_APP_SECRET` 必须来自目标微信小程序；`WECHAT_AUTH_VERIFIER_MODE` 在生产只能为 `wechat`。缺失、占位、fake verifier 或格式错误会让 API 启动失败。
- Nginx 模板默认 upstream 为 `127.0.0.1:4173` 和 `127.0.0.1:3001`，公网只允许开放 Nginx 的 HTTPS 入口。真实防火墙、安全组和端口不可达性必须在目标服务器人工验证，仓库测试只能证明模板与配置层契约。
- 生产上线前必须配置强 `JWT_SECRET`，并通过 `admin:bootstrap` 显式创建首个管理员。

## 后台账户恢复运维

`admin:bootstrap`、服务器密码重置和 Web 恢复链接是三条互斥路径：

- 空库首次部署：`pnpm --filter api admin:bootstrap -- --username <name> --password-stdin` 创建首个 `SUPER_ADMIN`。
- 现有 `SUPER_ADMIN` 忘记密码：在服务器执行 `pnpm --filter api admin:password:reset -- --username <name> --password-stdin`。密码只能从 stdin 读取；命令拒绝 `ADMIN`/`USER`，不创建、不启用账户。
- `ADMIN` 忘记密码：由 `SUPER_ADMIN` 在后台生成一次性恢复链接。
- `USER` 忘记密码：由 `ADMIN` 或 `SUPER_ADMIN` 生成一次性恢复链接。

链接只能通过受控渠道交付给目标用户，不得写入工单正文、聊天机器人日志、访问日志或监控标签。生成新链接会立即撤销目标现有 session 和旧链接；一次消费、过期、角色/状态/权限变化后均不可再用。

## 小程序客户端 API 访问边界

生产 `/api/client/**` 的身份边界是微信小程序 `wx.login` 临时 code 经服务端 `code2Session` 校验后签发的短期客户端会话。唯一匿名例外是 `POST /api/client/auth/wechat`；除此之外，客户端 API 都必须携带 `Authorization: Bearer <client-session-token>`。CORS、`Origin`、`Referer`、`User-Agent`、自定义 Header 和 IP 白名单不能替代该会话。

小程序构建时 `TARO_APP_API_BASE_URL` 必须指向已配置到微信后台 request 合法域名的真实 HTTPS origin。`weapp` 构建默认会拒绝 `127.0.0.1`、`localhost`、`.test`、`example.*` 等本地或占位地址；仅本地临时调试可设置 `ALLOW_UNSAFE_MINIAPP_API_BASE_URL=true` 跳过。服务端只保存 token hash、openid/unionid hash 和过期/撤销字段；`session_key`、AppSecret、openid/unionid 和 raw token 不返回前端。

## 应用层限流与可信代理

- API 只信任来自 loopback 反向代理的转发客户端地址；非 loopback 直连请求携带的 `X-Forwarded-For` 不参与登录和统计限流键计算。
- Nginx 作为唯一公网入口时，继续向 API 传递 `X-Forwarded-For`；Fastify 会从可信 loopback 连接中选择最近的非可信客户端地址，客户端伪造的更早 XFF 值不能绕过限流。
- 登录失败限流默认按“可信客户端 IP + 规范化用户名”计算，每 15 分钟最多 5 次失败；成功登录会清除该组合计数。
- `/api/client/track/page-view` 默认按可信客户端 IP 每分钟最多 60 次请求；超限统一返回 `429/RATE_LIMITED`，并带 `Retry-After`。
- 当前实现是单 API 进程内存限流，符合本阶段单实例 SQLite 部署假设。若生产改为多个 API 实例、副本或跨机器部署，必须先请求 Planner revision，改用共享限流存储后再上线。

## 错误封装与安全日志

- API 默认输出 Fastify/Pino JSON 结构化日志，并在每个响应返回 `X-Request-Id`。
- 未知 5xx 与可恢复媒体/文件错误只向客户端返回稳定错误码、通用消息和 `requestId`；SQL、堆栈、本地文件路径、token、password、secret 等内部信息不得出现在响应体。
- 日志集中脱敏 `Authorization`、Cookie、JWT、token、password、secret、敏感配置和请求体敏感字段。媒体恢复类错误会把运维定位信息写入日志，供按 `requestId` 排查。
- 当前安全事件日志覆盖登录失败、登录限流、匿名统计限流、logout/session 撤销、密码修改、备份创建、备份下载、备份删除、外部导入和恢复。下载/导入/恢复日志只记录来源、操作者、结果、requestId、备份 ID、摘要大小和 SHA-256 等摘要，不记录归档内容、敏感请求体、Authorization 或本地路径。

## 统计采样与保留清理

- 页面访问统计默认按 10% 确定性采样，入库记录携带 `sampleWeight=10`；后台看板展示的是按权重聚合后的估算浏览人次。
- 统计匿名指纹由可信客户端 IP 和规范化 User-Agent 通过每日轮换 HMAC 生成，数据库不保存原始 IP。
- 同一匿名指纹、页面和场景在默认 30 秒窗口内只计一次。
- 页面访问统计默认保留 90 天。定时任务可先运行 `pnpm analytics:cleanup -- --dry-run` 查看将删除数量，再运行 `pnpm analytics:cleanup` 删除超过保留期的记录；边界当天记录会保留。

## 构建和启动

```bash
pnpm install --frozen-lockfile
pnpm db:push
read -r -s BOOTSTRAP_PASSWORD
printf '%s\n' "$BOOTSTRAP_PASSWORD" | pnpm admin:bootstrap -- --username <admin-username> --password-stdin
unset BOOTSTRAP_PASSWORD
pnpm --filter api build
pnpm --filter admin build
TARO_APP_API_BASE_URL="$REAL_WEAPP_API_ORIGIN" pnpm --filter miniapp build:weapp
```

`pnpm db:seed` 只用于非生产演示内容初始化；`NODE_ENV=production` 时会在写入数据库或 `uploads` 前失败。

微信小程序包内的 API Base URL 是构建时常量，不会在上传后读取服务器 `.env`。生产上传前必须确认 `REAL_WEAPP_API_ORIGIN` 或 `.env` 中的 `TARO_APP_API_BASE_URL` 指向真实公网 HTTPS origin，且这个 origin 已加入微信小程序后台 request 合法域名；可以写入仓库根目录 `.env`，也可以像上面的命令一样在构建命令前显式传入。改完 `.env` 后必须重新执行 `pnpm --filter miniapp build:weapp` 并重新上传小程序。

启动 API：

```bash
API_HOST=127.0.0.1 API_PORT=3001 PUBLIC_BASE_URL=https://your-domain.example pnpm start:api
```

启动 Admin 静态服务：

```bash
ADMIN_HOST=127.0.0.1 ADMIN_PORT=4173 pnpm start:admin
```

进程管理可使用 systemd、PM2 或部署平台自带守护方式；仓库只要求上述命令接口稳定，不强制具体选型。Admin 生产服务只服务 `apps/admin/dist`，不是 Vite 开发服务器。

## Nginx

模板位于：

```text
deploy/nginx/eventarts-miniapp.conf.template
```

启用步骤示例：

```bash
sudo cp deploy/nginx/eventarts-miniapp.conf.template /etc/nginx/conf.d/eventarts-miniapp.conf
sudo nginx -t
sudo systemctl reload nginx
```

接入 HTTPS 时，将 `listen 80`、`server_name _` 和证书配置替换为目标环境值。模板内的 TLS/HSTS 片段是注释化 guardrail，只能在安装真实证书、确认最终域名 HTTPS 可用后启用；不要把占位证书路径当作真实证书或可直接使用的域名配置。微信小程序后台需要配置 HTTPS request 合法域名，域名应与 `TARO_APP_API_BASE_URL` 的 origin 一致。

`client_max_body_size` 当前模板为 `120m`，应始终不低于 `MAX_VIDEO_UPLOAD_BYTES` 对应的业务上限。

## 验证

部署后执行：

```bash
curl -I https://your-domain.example/admin
curl -I https://your-domain.example/admin/
curl -I https://your-domain.example/admin/assets/<built-asset>.js
curl -i https://your-domain.example/api/client/home
curl -i -X POST https://your-domain.example/api/client/auth/wechat -H 'Content-Type: application/json' --data '{"code":"<wx.login-code>"}'
curl -I https://your-domain.example/uploads/<known-file>
```

期望：

- `/admin` 返回 `308`，`Location: /admin/`。
- `/admin/` 返回 Admin HTML。
- `/admin/dashboard`、`/admin/detail-pages/new` 刷新返回 Admin HTML，未登录时进入 `/admin/login`。
- Admin 静态资源 URL 为 `/admin/assets/...`。
- `/api/...` 到 API upstream 的路径仍包含 `/api`。
- 匿名 `GET /api/client/home` 返回 `401/CLIENT_AUTH_REQUIRED`；用真实小程序 `wx.login` code 调用 `POST /api/client/auth/wechat` 成功后，带返回的 client bearer token 再访问 `/api/client/home`。
- `/uploads/...` 到 API upstream 的路径仍包含 `/uploads`。
- API 响应中的本地媒体 URL 使用当前 `PUBLIC_BASE_URL` 生成，例如 `https://your-domain.example/uploads/...`；SQLite 中本地资源仍保存 `/uploads/...` 相对路径。

仓库内验证命令：

```bash
pnpm lint
pnpm test
pnpm --filter admin build
pnpm --filter api build
pnpm test:deploy
pnpm deploy:smoke
pnpm security:release-gate
pnpm e2e
```

`pnpm deploy:smoke` 检查 `.env`/进程环境中的 `API_HOST`、`ADMIN_HOST` 以及 Nginx upstream 是否为 loopback，并输出仍需人工完成的防火墙和公网入口检查。它不会扫描真实服务器端口，也不能替代目标环境的安全组、防火墙和 `nginx -t`。

`pnpm security:release-gate` 是发布安全门禁。它会阻断自动化可发现的 P0/P1 问题，包括默认管理员密码、默认 JWT、生产 seed 防护缺失、Fastify 公网绑定、CORS 反射、登录/匿名统计限流、管理员 session 撤销、结构化日志脱敏、备份/恢复契约和本文档必需步骤缺失。

若服务器安装了 Nginx，在发布前执行：

```bash
sudo nginx -t
```

本地未安装 Nginx 时只能记录未执行，不能把静态模板检查等同于 `nginx -t`。

发布门禁不能替代目标环境检查。上线前仍需在真实服务器人工确认：

- TLS 证书、HSTS、微信 request 合法域名与公网 HTTPS 入口。
- 真实微信小程序 `wx.login -> /api/client/auth/wechat -> /api/client/home` 链路，确认目标 AppID/AppSecret、合法域名和小程序包内 API origin 一致。
- 防火墙/安全组只开放 Nginx HTTPS 入口，API/Admin Fastify 端口不可从公网访问。
- `analytics:cleanup` 和备份保留策略由调度器定期执行，并记录失败告警。
- `BACKUP_DIR` 磁盘容量、权限、异地备份复制、RTO/RPO 指标和恢复演练结果。
- 灾难演练至少覆盖“创建备份 -> 修改数据和 uploads -> 恢复 -> 校验数据/uploads/session 撤销 -> 回滚到恢复点”。

## 备份和回滚

API 提供受保护的后台备份接口：

- `POST /api/admin/backups` 创建备份。
- `GET /api/admin/backups` 查看备份列表。
- `GET /api/admin/backups/:id/download` 以管理员 Bearer 鉴权流式下载已重新校验的 `ready` 备份 `.tar.gz`；响应禁止缓存，备份目录不产生公共 URL，下载期间同一备份不可删除。
- `POST /api/admin/backups/import` 导入外部 `.tar`/`.tar.gz` 备份并执行预检。
- `POST /api/admin/backups/:id/restore` 执行全量恢复，body 必须包含 `{ "backupId": "<same-id>", "confirmation": "RESTORE_FULL_BACKUP" }`。
- `DELETE /api/admin/backups/:id` 删除可删除状态备份，body 必须包含 `{ "backupId": "<same-id>", "confirmation": "DELETE_BACKUP" }`。

备份目录由 `BACKUP_DIR` 指定，必须位于 `UPLOAD_DIR` 之外；配置校验会拒绝把备份目录放在 uploads 内。Nginx 只代理 `/uploads/`，不暴露 `BACKUP_DIR`，API 也不会返回备份公共 URL。

备份内容：

- 通过 SQLite `VACUUM INTO` 生成的一致性 `database.sqlite` 快照，禁止直接复制活动 DB 文件作为应用备份。
- `uploads` 普通文件副本；排除备份目录、临时文件、`.tmp`、`.trash`、隐藏文件/目录、符号链接、目录和 uploads root 外路径。
- `manifest.json`，包含格式版本、app/schema metadata、创建者、时间戳、数据库快照元数据、上传文件元数据、大小和 SHA-256。

创建流程先写入 `BACKUP_DIR/.staging`，完成文件和 manifest 校验后原子发布到最终备份目录；失败会清理 staging，不留下 partial published backup。并发创建会返回 `409/BACKUP_CONFLICT`。创建/下载/删除成功和失败都会写 `operation_logs` 与安全事件日志。

下载由 API 进程从私有备份目录流式生成 tar.gz，不应在 Nginx 中为 `BACKUP_DIR` 增加 `alias`、静态 location 或 CDN 回源。生产发布需结合最大备份体积验证代理读取超时、磁盘吞吐和响应缓冲；当前一期不支持 Range 或断点续传。备份中 `system_config` 仅含密文，下载归档不包含外部 `EDGEONE_CREDENTIAL_ENCRYPTION_KEY`，该主密钥仍须独立保管。

外部导入流程：

1. 将归档上传到 `POST /api/admin/backups/import`。
2. API 先在 `BACKUP_DIR/.imports` 解包，拒绝链接、路径穿越、不支持 tar 类型、过多文件、过大展开体积、过高展开比、checksum 不一致、坏 SQLite、schema 不兼容和媒体清单不一致。
3. 预检通过后才发布为 `import-*` 备份条目；响应只返回影响摘要，不返回归档内容或本地路径。
4. 根据摘要确认表级影响后，再调用 restore API。

恢复流程：

1. 使用 `GET /api/admin/backups` 选择目标备份 ID。
2. 调用 `POST /api/admin/backups/:id/restore`，请求体必须同时包含相同 `backupId` 和 `RESTORE_FULL_BACKUP`。
3. API 进入维护模式，阻止业务写入；恢复前自动创建一个 G08 恢复点，响应中的 `snapshotBackupId` 即为回滚点。
4. API 在隔离位置验证候选 DB/uploads 后，尽可能原子切换本地 SQLite 与 uploads；失败会自动回滚到恢复前状态。
5. `identityRestorePolicy: preserve_target`：保留目标环境当前后台账户、密码 hash、角色、菜单权限和个人通知；忽略归档中的 `admin_sessions` 与 `admin_password_reset_tokens`，并使目标环境现有 session/token 全部失效。
6. 成功后所有后台用户都必须重新登录；候选备份中的任何账户或凭据都不会恢复为线上身份。

发布前除应用备份外仍建议保存：

- 当前 Nginx 配置文件。
- 当前 Admin `dist` 产物和 API 构建产物。

常规人工回滚顺序：

1. 停止新版本 Admin/API 进程。
2. 如果 restore API 已成功返回，优先用返回的 `snapshotBackupId` 再执行一次恢复，回到恢复前快照。
3. 若 API 不可启动，停止进程后手工恢复上一版 SQLite 文件和 `uploads`，或从 `BACKUP_DIR/<snapshotBackupId>/database.sqlite` 与 `BACKUP_DIR/<snapshotBackupId>/uploads` 复制恢复。
4. 恢复上一版 Nginx 配置并运行 `nginx -t`。
5. 重新启动进程并 reload Nginx。
6. 重新验证 `/admin/`、`/api/client/home` 和一个已知 `/uploads/...` 文件。

崩溃恢复说明：

- 恢复切换使用生产 DB/uploads 旁的临时路径，形如 `.prod.db.<restoreId>.new`、`.prod.db.<restoreId>.old`、`.uploads.<restoreId>.new`、`.uploads.<restoreId>.old`，失败保留的候选状态可能以 `.failed` 结尾。
- 如果 API 在恢复中崩溃，先停止 API，确认没有进程持有 SQLite 文件，再按同一 `restoreId` 检查生产路径、`.old`、`.new` 和 `.failed`。
- 若生产 `DATABASE_URL` 指向的 SQLite 文件和 `UPLOAD_DIR` 都存在且可通过 `PRAGMA integrity_check`、媒体访问验证，可先只保留现场并重启；随后立即创建新备份。
- 若生产路径缺失或验证失败，优先把对应 `.old` DB/uploads 移回生产路径；若 `.old` 不完整，使用 restore API 创建的 `snapshotBackupId` 手工恢复。
- 手工移动文件前先复制现场目录到离线位置，避免覆盖唯一线索。恢复后执行 `pnpm --filter api build`、启动 API、登录后台、验证 `/api/client/home` 和一个已知 `/uploads/...` 文件。
