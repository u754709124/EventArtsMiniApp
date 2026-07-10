# EventArtsMiniApp

EventArtsMiniApp 是一期微信小程序交付项目，包含 Taro 小程序、Fastify API、React Ant Design 后台、共享类型、自动化测试和阶段文档。

## 环境要求
- Node.js `22.12+`
- pnpm `11.x`
- SQLite 本地开发数据库
- 微信开发者工具，用于导入和预览微信小程序端产物

## 安装依赖
```bash
pnpm install
```

在 CI 或无 TTY 环境中可使用：
```bash
CI=true pnpm install
```

## 环境变量
复制 `.env.example` 为 `.env`，并按环境修改：
- `API_PORT`：API 监听端口，默认 `3001`
- `JWT_SECRET`：管理员 JWT 密钥，生产环境必须替换
- `DATABASE_URL`：SQLite 数据库地址，默认 `file:./dev.db`
- `UPLOAD_DIR`：本地上传目录，默认指向仓库根目录 `uploads`
- `PUBLIC_BASE_URL`：资源 URL 前缀
- `VITE_API_BASE_URL`：后台管理系统 API Base URL；本地也可留空走 Vite proxy
- `TARO_APP_API_BASE_URL`：Taro H5/weapp 编译时注入的小程序 API Base URL

## 初始化数据库
```bash
pnpm db:push
pnpm db:seed
```

默认管理员账号：
- 用户名：`admin`
- 密码：`admin123456`

生产环境上线前必须修改默认密码和 `JWT_SECRET`。

## 本地启动
```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:h5
```

默认地址：
- API：`http://127.0.0.1:3001`
- Admin：`http://127.0.0.1:5173`
- Miniapp H5：`http://127.0.0.1:10086`

## 构建
```bash
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

微信小程序端构建完成后，将 `apps/miniapp/dist` 导入微信开发者工具。

## 测试
```bash
pnpm lint
pnpm test
pnpm e2e
```

E2E 会自动启动 API、Admin 和 Taro H5，并生成首页设计复核截图 `docs/design/actual-home-h5.png`。

## 上传目录
本地上传文件存储在仓库根目录 `uploads`。`media_assets` 会记录文件名、类型、用途、URL、宽高、大小和上传时间。正在被 Banner、菜单、案例、人员头像或站点配置引用的资源不可删除。

## 对象存储预留
一期默认使用本地存储，数据库字段已保留 `storageType` 和稳定 `url`。生产迁移对象存储时建议保持 API 返回 URL 不变，或通过 CDN/对象存储域名更新 `PUBLIC_BASE_URL`。

## 生产注意事项
- 替换默认管理员密码和 `JWT_SECRET`。
- 设置生产 `DATABASE_URL`、`PUBLIC_BASE_URL`、`VITE_API_BASE_URL`、`TARO_APP_API_BASE_URL`。
- 为 `/uploads` 或对象存储配置备份、访问控制和 CDN。
- 使用 HTTPS API 域名，并在微信小程序后台配置 request 合法域名。
- 使用 `pnpm build:weapp` 后在微信开发者工具中复核页面、TabBar、上传资源访问和接口域名。

## 文档
- 阶段文档：`docs/stages`
- 接口文档：`docs/api/index.md`
- 设计资料和截图：`docs/design`
- 项目规范：`AGENTS.md`
