# Stage 0 - Foundation

## 阶段目标
初始化 monorepo、项目规范、基础脚本、共享类型和阶段文档。

## 功能范围
pnpm workspace、TypeScript strict、ESLint、Prettier、Vitest、Playwright、AGENTS.md、README.md。

## 主要文件
根配置、`packages/shared`、`docs/stages`。

## 数据结构或接口
共享枚举、统一 API 响应类型。

## 测试方式
`pnpm lint`、`pnpm test`。

## 验收清单
- [ ] workspace 可安装依赖
- [ ] 共享类型测试通过
- [ ] 项目规范和 README 完成

## 已完成事项
- 初始化 pnpm workspace、共享类型、根脚本、ESLint、Prettier、Vitest。
- 创建 `AGENTS.md`、`README.md`、API 文档、阶段文档和分阶段计划文件。
- `pnpm lint`、`pnpm test` 已通过。

## 对应 git commit hash
0ae937b

## 已知问题或设计取舍
空仓库初始化，先建立最小可运行骨架。
