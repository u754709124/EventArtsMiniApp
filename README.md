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
- `MAX_IMAGE_UPLOAD_BYTES`：图片上传上限，默认 `10MB`
- `MAX_VIDEO_UPLOAD_BYTES`：视频上传上限，默认 `100MB`
- `PUBLIC_BASE_URL`：资源 URL 前缀
- `VITE_API_BASE_URL`：后台管理系统 API Base URL；本地也可留空走 Vite proxy
- `TARO_APP_API_BASE_URL`：Taro H5/weapp 编译时注入的小程序 API Base URL

## 初始化数据库

```bash
pnpm db:push
pnpm db:seed
```

`db:push` 会创建公共详情配置表并执行幂等 SQLite 兼容迁移；`db:seed` 可重复运行，并按稳定 seed key 写入人员/案例的两类详情示例。旧人员 `detail`、旧案例 `detail`/`legacyMediaJson` 会迁入公共详情配置，旧列仅作为 deprecated 兼容数据保留。升级前请同时备份 SQLite 文件和 `uploads`；无法解释的非空旧媒体或缺失物理文件会中止预检，不会静默丢弃。

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

本地详情联调建议先运行 `pnpm db:push && pnpm db:seed`。seed 中“林然”和“浪漫粉色系户外婚礼”是 BANNER + 富文本；“Jessica”和“企业年会歌手演出”是单富文本。测试和调试应按这些稳定名称/标题从 API 解析 ID，不要假设 SQLite 自增值。

## 构建

```bash
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

微信小程序端构建完成后，将 `apps/miniapp/dist` 导入微信开发者工具。

## 人员列表参考资源

人员列表参考图及其六张可复现的示例封面资源位于 `docs/design` 和 `apps/miniapp/src/assets/generated`。重新生成资源请运行：

```bash
pnpm assets:slice:artists
```

脚本会验证参考图尺寸，并输出固定 `690 × 480` 的人员封面资源及资源清单；种子数据会按媒体库方式注册这些资源。

## 公共详情页与参考资源

人员和活动案例共用 `detailPage` 契约、Admin 动态表单、API 清洗/媒体关系与 Taro renderer。支持：

- `banner_rich_text`：宣传语、1–6 张有序图片 BANNER 和富文本。
- `rich_text`：只有富文本，没有 BANNER DOM、高度、页码或负重叠。

重新生成详情参考资源：

```bash
pnpm assets:slice:artist-detail
```

脚本校验 `898 × 1751` 权威参考图和 SHA-256，输出坐标网格、显式 manifest、26 个确定性资源与 contact sheet。架构、安全白名单、视觉测量和第三种 renderer 扩展步骤见 `docs/design/detail-page-system.md`。

## 测试

```bash
pnpm lint
pnpm test
pnpm e2e
```

E2E 会自动启动 API、Admin 和 Taro H5，并生成首页设计复核截图 `docs/design/actual-home-h5.png`。

聚焦公共详情工作流和四张视觉截图：

```bash
pnpm e2e -- --project=miniapp-h5 --grep "详情"
pnpm e2e -- --project=miniapp-h5 --grep "四种详情页视觉截图与人员详情对齐差异图"
```

第二条命令使用约 `427 × 922` viewport、DPR 2，固定首张 BANNER，等待字体和图片稳定，生成四张准确命名截图、`overlay-artist-detail.png`、`diff-artist-detail.png` 和带 SHA-256 的视觉证据 JSON。差异图按宽度等比缩放参考、顶部对齐并裁到较短高度，不代表像素级一致。

## 上传目录

本地上传文件存储在仓库根目录 `uploads`。资源库不区分业务用途；资源保存全局唯一资源名、原始文件名、MD5、真实格式与尺寸、标签、上传人和时间，物理文件使用随机 32 位十六进制名称防止覆盖。业务表单继续以整数资源 ID 建立关联。

管理端会在上传前读取图片/视频尺寸并分片计算 MD5；服务端会重新计算并校验。MD5 已存在时直接复用资源；Banner、菜单图标、案例封面等固定槽位会在上传和最终保存时再次校验尺寸。正在被站点配置、Banner、菜单、案例封面、公共详情 BANNER/富文本或人员头像引用的资源不可删除。

## 对象存储预留

一期默认使用本地存储，数据库字段已保留 `storageType` 和稳定 `url`。生产迁移对象存储时建议保持 API 返回 URL 不变，或通过 CDN/对象存储域名更新 `PUBLIC_BASE_URL`。

## 生产注意事项

- 替换默认管理员密码和 `JWT_SECRET`。
- 设置生产 `DATABASE_URL`、`PUBLIC_BASE_URL`、`VITE_API_BASE_URL`、`TARO_APP_API_BASE_URL`。
- 为 `/uploads` 或对象存储配置备份、访问控制和 CDN。
- 从旧版本升级前必须同时备份 SQLite 数据库与完整 `uploads` 目录。迁移预检遇到缺失文件或无法解释的非空旧 `mediaJson` 会停止，不会猜测或丢弃数据。
- 使用 HTTPS API 域名，并在微信小程序后台配置 request 合法域名。
- 使用 `pnpm build:weapp` 后在微信开发者工具中复核页面、TabBar、上传资源访问和接口域名。

## 文档

- 阶段文档：`docs/stages`
- 接口文档：`docs/api/index.md`
- 设计资料和截图：`docs/design`
- 项目规范：`AGENTS.md`
