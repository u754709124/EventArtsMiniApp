# Stage 3 - Admin CMS

## 阶段目标
实现后台登录、看板、首页配置、公告、Banner、菜单、案例、人员和资源管理。

## 功能范围
React + Vite + TypeScript + Ant Design。

## 主要文件
`apps/admin`。

## 数据结构或接口
使用 `/api/admin/*` 接口和共享类型。

## 测试方式
`pnpm --filter admin build`、`pnpm lint`、`pnpm test`；E2E 在 Stage 5 统一执行。

## 验收清单
- [x] 登录态刷新保留
- [x] 未登录跳转登录页
- [x] 表单校验和反馈
- [x] 删除二次确认
- [x] 动态菜单配置表单

## 已完成事项
- 已实现 React + Vite + TypeScript + Ant Design 后台。
- 已实现登录页、token 持久化、受保护布局、侧边栏、退出登录。
- 已实现数据看板，展示今日、本周、本月 PV。
- 已实现首页配置，支持从资源库选择默认图和占位图。
- 已实现公告、Banner、菜单、案例、人员 CRUD 抽屉表单和分页表格。
- 菜单管理支持五种固定类型，并按类型动态展示配置字段。
- 已实现资源管理上传、用途选择、预览、删除确认和引用删除错误提示。
- 已添加稳定 `data-testid` 供 Stage 5 Playwright 使用。
- 验证通过：`pnpm --filter admin build`、`pnpm lint`、`pnpm test`。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
一期不做权限细分、忘记密码、趋势图。当前后台为单包 Ant Design 应用，生产构建存在单 chunk 超过 500 kB 的 Vite 警告；一期保留，后续可做路由级 code splitting。
