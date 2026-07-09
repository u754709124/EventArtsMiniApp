# Stage 6 - Weapp Build and Deploy

## 阶段目标
完成最终集成检查、微信小程序构建和部署说明。

## 功能范围
构建命令、导入目录、环境变量、API Base URL、资源存储、上线前清单。

## 主要文件
`apps/miniapp/dist`、README、阶段文档。

## 数据结构或接口
生产环境使用同一 API 响应格式。

## 测试方式
最终运行：
```bash
pnpm install
pnpm lint
pnpm test
pnpm e2e
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

## 验收清单
- [ ] weapp 构建成功
- [ ] 微信开发者工具导入目录明确
- [ ] 生产环境变量说明完成
- [ ] 上线前检查清单完成

## 已完成事项
待回填。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
待最终集成后回填。
