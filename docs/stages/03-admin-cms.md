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
`pnpm --filter admin build`、`pnpm e2e`。

## 验收清单
- [ ] 登录态刷新保留
- [ ] 未登录跳转登录页
- [ ] 表单校验和反馈
- [ ] 删除二次确认
- [ ] 动态菜单配置表单

## 已完成事项
待回填。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
一期不做权限细分、忘记密码、趋势图。
