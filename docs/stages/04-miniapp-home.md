# Stage 4 - Miniapp Home

## 阶段目标
实现 Taro 首页、基础路由、TabBar、接口状态和 H5/weapp 构建。

## 功能范围
首页 6 个模块、公告/案例/人员/联系/分类/我的基础页面。

## 主要文件
`apps/miniapp`。

## 数据结构或接口
`GET /api/client/home`、`GET /api/client/menu-items` 与详情列表接口。

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
- 首页菜单只展示 `showOnHome=true` 的启用菜单；分类页调用 `GET /api/client/menu-items` 展示全部启用菜单。
- 菜单跳转规则严格对应 `host`、`singer`、`actor`、`activity_case`、`article`、`contact`；文章菜单使用 `navigateTo` 打开 `/pages/articles/list` 并携带分类/pageSize query。
- 案例页支持顶部关键词搜索，按单列 710rpx 案例卡片展示，并复用首页精选案例的信息结构。
- 已完成首页视觉校准：H5 顶部安全区为 36px，微信端仍使用胶囊按钮位置；标题/副标题采用 36rpx/24rpx 明确行高，公告栏与 Banner 纵向节奏对齐参考图。
- 已将精选案例卡片的文字区固定为 224rpx，标题与简介限制为两行，封面改为块级元素以消除 H5 行内基线空隙；首卡 H5 实测高度为 219px。
- H5 和 weapp 构建均已成功。
- 验证通过：`pnpm --filter miniapp build:h5`、`pnpm build:weapp`、`pnpm lint`、`pnpm test`。

## 对应 git commit hash
6dd9a7d

## 已知问题或设计取舍
参考图下方扩展模块不纳入一期交互范围。H5 截图不模拟微信状态栏和胶囊按钮，因此采用独立的 36px 顶部安全区；微信端保持运行时胶囊按钮适配。Taro 构建需要写入 `~/.taro4.0` 缓存目录，sandbox 内需授权运行。后续已将首页切图改为 palette PNG 并配置构建 performance budget，H5/weapp 当前构建无 warning 输出。
