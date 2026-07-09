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
`pnpm --filter miniapp build:h5`、`pnpm build:weapp`、`pnpm e2e`。

## 验收清单
- [ ] 首页失败状态可重试
- [ ] 空公告隐藏
- [ ] 无 Banner 显示默认图
- [ ] 图片失败显示占位图
- [ ] 五类菜单跳转正确
- [ ] 固定 TabBar 可用

## 已完成事项
待回填。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
参考图下方扩展模块不纳入一期交互范围。
