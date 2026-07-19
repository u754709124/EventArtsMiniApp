# Stage 11 — 后台 RBAC 与身份安全恢复

## 目标

本阶段将后台账户扩展为固定三级角色，增加按菜单叶子节点授权、账户管理、一次性激活/恢复链接和 `SUPER_ADMIN` 服务器重置命令；同时把备份恢复改为保留目标环境身份平面，防止导入其他环境的账户密码后无法登录。2026-07-19 补充：新本地备份升级为 v3 非身份数据归档；同日后续范围变更移除了每日自动备份任务。

## 权限与恢复规则

| 发起者 | 可管理目标 | 可生成恢复链接 | 忘记密码路径 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | 其他 `SUPER_ADMIN`、`ADMIN`、`USER` | `ADMIN`、`USER` | 服务器 `admin:password:reset` |
| `ADMIN` | `USER` | `USER` | 由 `SUPER_ADMIN` 生成链接 |
| `USER` | 无 | 无 | 由 `ADMIN` 或 `SUPER_ADMIN` 生成链接 |

`SUPER_ADMIN` 可管理其他 `SUPER_ADMIN`，但不能通过 Web 自助管理自身；涉及 `SUPER_ADMIN` 的角色/状态变更要求当前密码和显式确认，且系统始终保留至少一个启用的 `SUPER_ADMIN`。同级恢复链接、向上/向下越权、自助签发和所有指向 `SUPER_ADMIN` 的 Web 链接均拒绝。新建 `ADMIN`/`USER` 为 `pending_activation`，通过一次性激活链接设置首个密码，不能通过一次性链接新建 `SUPER_ADMIN`。服务端从实时数据库加载角色与叶子菜单权限；敏感菜单（备份、系统配置、定时任务）可由 `SUPER_ADMIN` 授予但不能由 `ADMIN` 继续下放；缺少路由策略时默认拒绝。

## 备份恢复语义

新本地归档为 manifest v3，并标记 `identityRestorePolicy: preserve_target`、`dataScope: non_identity` 和 `backupKind`。v3 只恢复业务数据和 uploads，不包含 `admin_users`、`admin_menu_permissions`、后台 session/reset token、管理员个人通知、客户端会话、访问事件、操作日志、EdgeOne 预热运行态和定时任务状态；`media_assets.createdBy` 在快照中置空。旧 v1/v2 归档仍可兼容预检和恢复，但候选身份表永远不会成为线上身份。恢复时保留目标环境当前身份平面与个人通知，清空全部管理员 session/reset token，并创建 `restore_snapshot` 安全快照。历史操作者仅按稳定 `publicId` 映射，无法映射的可空引用置空；无法安全映射的敏感运行态被明确丢弃。

## 自动备份历史兼容

本阶段曾实现每日自动备份，后续范围变更已删除该调度任务及后台立即执行入口。当前新备份仅由管理员手动创建或由恢复流程创建安全快照；已有 `backupKind: "automatic"` 归档继续支持列表、下载、删除、预检和恢复，不删除历史文件或任务状态。

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
