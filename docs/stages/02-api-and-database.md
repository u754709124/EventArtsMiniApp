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
`pnpm --filter api test`、`pnpm test`。

## 验收清单
- [ ] API 统一响应
- [ ] 上传尺寸后端校验
- [ ] 引用资源不可删除
- [ ] 首页聚合过滤 disabled 数据
- [ ] PV 统计返回今日、本周、本月

## 已完成事项
待回填。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
本地 SQLite；生产可迁移到托管数据库和对象存储。
