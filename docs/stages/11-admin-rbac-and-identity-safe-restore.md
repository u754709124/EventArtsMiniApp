# Stage 11 — 后台 RBAC 与身份安全恢复

## 目标

本阶段将后台账户扩展为固定三级角色，增加按菜单叶子节点授权、账户管理、一次性激活/恢复链接和 `SUPER_ADMIN` 服务器重置命令；同时把全量备份恢复改为保留目标环境身份平面，防止导入其他环境的账户密码后无法登录。

## 权限与恢复规则

| 发起者 | 可管理目标 | 可生成恢复链接 | 忘记密码路径 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | `ADMIN`、`USER` | `ADMIN`、`USER` | 服务器 `admin:password:reset` |
| `ADMIN` | `USER` | `USER` | 由 `SUPER_ADMIN` 生成链接 |
| `USER` | 无 | 无 | 由 `ADMIN` 或 `SUPER_ADMIN` 生成链接 |

同级、向上、自助签发和所有指向 `SUPER_ADMIN` 的 Web 链接均拒绝。新建 `ADMIN`/`USER` 为 `pending_activation`，通过一次性激活链接设置首个密码。服务端从实时数据库加载角色与叶子菜单权限；缺少路由策略时默认拒绝。

## 备份恢复语义

新归档为 manifest v2，并标记 `identityRestorePolicy: preserve_target`。恢复业务数据和 uploads，但保留目标环境当前 `admin_users`、`admin_menu_permissions` 与管理员个人通知；候选和当前的 `admin_sessions`、`admin_password_reset_tokens` 均清空。历史操作者仅按稳定 `publicId` 映射，无法映射的可空引用置空；EdgeOne 等必须有创建者的候选记录在无法安全映射时被明确丢弃。

## 自动化证据

截至集成验收：

- 账户/RBAC/session/密码恢复定向矩阵：4 个文件、19 项通过。
- 备份/恢复/身份隔离定向矩阵：3 个文件、18 项通过。
- 全仓 `pnpm test`：shared 49、miniapp 69、API 261、admin 162、部署脚本 9、构建脚本 4，全部通过。
- `pnpm lint`、API build、Admin build 与包体预算检查通过。
- `pnpm security:release-gate` 通过；门禁额外扫描 production reset 流中的 console、浏览器存储和完整 reset URL literal 泄露，并校验 fragment/no-referrer/hash/CLI/身份保留标记。
- `pnpm e2e`：65/65 通过，其中后台 24/24、小程序 H5 41/41。新增真实浏览器用例覆盖 USER 激活、菜单裁剪、无权限 URL 直达 403、SUPER_ADMIN 用户管理与恢复链接不落浏览器存储。
- 独立身份安全恢复演练 `pnpm --filter api exec vitest run test/identity-safe-restore.test.ts --no-file-parallelism --maxWorkers=1`：3/3 通过。
- 完整 `pnpm release:check` 已依次通过安全门禁、lint、全仓测试、65 项 E2E、API/Admin/小程序 H5 构建及预算，但在微信构建入口因当前 shell 的 `WECHAT_MINIAPP_APP_ID` 与仓库公开 AppID 不一致退出。使用仓库 AppID 执行 `WECHAT_MINIAPP_APP_ID=wx5ec063dad7963593 pnpm build:weapp` 后构建和包体预算通过。因此所有发布检查组成项均已通过，但没有把该次退出码为 1 的完整聚合命令记为通过。

## 上线人工检查

- 在生产主机用 stdin 演练 `SUPER_ADMIN` 重置，确认输出不含密码/hash。
- 通过受控渠道交付 `ADMIN`/`USER` 一次性链接，确认 fragment 被页面立即清除。
- 用隔离数据库演练备份导入/恢复，核对业务数据恢复、目标身份保留、全部后台 session/token 失效。
- 确认 TLS、反向代理日志、APM 和错误采集均不记录完整 reset URL、token、密码或 hash。

以上生产环境 TLS、反向代理、防火墙、微信后台配置及异地备份恢复仍属于上线人工检查，本地自动化未代替这些环境验收。
