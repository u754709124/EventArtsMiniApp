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
MAX_IMAGE_UPLOAD_BYTES=10485760
MAX_VIDEO_UPLOAD_BYTES=104857600
PUBLIC_BASE_URL=https://your-domain.example
VITE_API_BASE_URL=
TARO_APP_API_BASE_URL=https://your-domain.example
```

关键约束：

- `PUBLIC_BASE_URL` 是公网 origin，例如 `https://your-domain.example`，不要追加 `/api`。
- 同源 Nginx 部署下 `VITE_API_BASE_URL` 留空或不注入，让 Admin 请求 `/api/...`。
- `API_HOST` 和 `ADMIN_HOST` 默认 `127.0.0.1`，不要设为公网地址。
- Nginx 模板默认 upstream 为 `127.0.0.1:4173` 和 `127.0.0.1:3001`。如果 API 进程在目标环境不能绑定回环地址，必须用防火墙或进程管理配置确保端口不对公网开放。
- 生产上线前必须更换默认管理员密码和 `JWT_SECRET`。

## 构建和启动

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm db:seed
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:weapp
```

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

接入 HTTPS 时，将 `listen 80`、`server_name _` 和证书配置替换为目标环境值。不要把仓库模板中的占位配置当作真实证书或域名配置。微信小程序后台需要配置 HTTPS request 合法域名，域名应与 `TARO_APP_API_BASE_URL` 的 origin 一致。

`client_max_body_size` 当前模板为 `120m`，应始终不低于 `MAX_VIDEO_UPLOAD_BYTES` 对应的业务上限。

## 验证

部署后执行：

```bash
curl -I https://your-domain.example/admin
curl -I https://your-domain.example/admin/
curl -I https://your-domain.example/admin/assets/<built-asset>.js
curl -i https://your-domain.example/api/client/home
curl -I https://your-domain.example/uploads/<known-file>
```

期望：

- `/admin` 返回 `308`，`Location: /admin/`。
- `/admin/` 返回 Admin HTML。
- `/admin/dashboard`、`/admin/detail-pages/new` 刷新返回 Admin HTML，未登录时进入 `/admin/login`。
- Admin 静态资源 URL 为 `/admin/assets/...`。
- `/api/...` 到 API upstream 的路径仍包含 `/api`。
- `/uploads/...` 到 API upstream 的路径仍包含 `/uploads`。

仓库内验证命令：

```bash
pnpm lint
pnpm test
pnpm --filter admin build
pnpm --filter api build
pnpm test:deploy
pnpm e2e
```

若服务器安装了 Nginx，在发布前执行：

```bash
sudo nginx -t
```

本地未安装 Nginx 时只能记录未执行，不能把静态模板检查等同于 `nginx -t`。

## 备份和回滚

发布前备份：

- SQLite 数据库文件。
- 完整 `uploads` 目录。
- 当前 Nginx 配置文件。
- 当前 Admin `dist` 产物和 API 构建产物。

回滚顺序：

1. 停止新版本 Admin/API 进程。
2. 恢复上一版构建产物、SQLite 文件和 `uploads`。
3. 恢复上一版 Nginx 配置并运行 `nginx -t`。
4. 重新启动进程并 reload Nginx。
5. 重新验证 `/admin/`、`/api/client/home` 和一个已知 `/uploads/...` 文件。
