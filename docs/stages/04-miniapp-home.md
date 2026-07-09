# Stage 4 - Miniapp Home

## 阶段目标
实现 Taro 首页、基础路由、TabBar、接口状态和 H5/weapp 构建。

## 功能范围
首页 6 个模块、公告/案例/人员/联系/分类/我的基础页面。

## 主要文件
`apps/miniapp`。

## 数据结构或接口
`GET /api/client/home` 与详情列表接口。

## 测试方式
`pnpm --filter miniapp build:h5`、`pnpm build:weapp`、`pnpm lint`、`pnpm test`；H5 E2E 在 Stage 5 统一执行。

## 验收清单
- [x] 首页失败状态可重试
- [x] 空公告隐藏
- [x] 无 Banner 显示默认图
- [x] 图片失败显示占位图
- [x] 五类菜单跳转正确
- [x] 固定 TabBar 可用

## 已完成事项
- 已实现 Taro 4 + React + TypeScript + SCSS miniapp 包。
- 已配置首页、公告详情、案例列表/详情、人员列表/详情、联系我们、分类、我的页面。
- 已实现固定四项 TabBar：首页、分类、案例、我的。
- 首页调用 `GET /api/client/home`，成功后上报 `POST /api/client/track/page-view`。
- 首页实现顶部标题区、公告栏、Banner、菜单卡片、精选案例、失败重试状态、空状态和图片 fallback。
- 菜单跳转规则严格对应 `host`、`singer`、`actor`、`activity_case`、`contact`。
- H5 和 weapp 构建均已成功。
- 验证通过：`pnpm --filter miniapp build:h5`、`pnpm build:weapp`、`pnpm lint`、`pnpm test`。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
参考图下方扩展模块不纳入一期交互范围。Taro 构建需要写入 `~/.taro4.0` 缓存目录，sandbox 内需授权运行。H5/weapp 构建对 `banner-default.png` 和 `placeholder-banner.png` 给出资源体积警告；这些文件按固定尺寸生成用于测试和 seed，后续生产应替换为压缩后的正式素材或 CDN 资源。
