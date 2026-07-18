# 演职人员列表页设计与资源说明

## 路由与分类

统一人员入口使用 `pages/artists/list`：

| 路由 | 页面标题、筛选行为 |
| --- | --- |
| `/pages/artists/list` | 人员；展示全部启用人员 |
| `/pages/artists/list?category=歌手` | 歌手；按任意人员分类精确筛选 |
| `/pages/artists/list?type=host` | 历史兼容深链；映射为主持人分类 |

人员分类是规范化自由文本，不再限制为三个预定义值。旧 `type=host|singer|actor` 仅作为兼容别名；新入口和 API 使用可选 `category`。页面只读取 DTO 的 `tags: string[]`，不读取或解析原始 `tagsJson`。

人员列表作为子页面，不渲染页面级底部菜单；用户通过顶部返回按钮回到分类页或上一级页面。

## 数据字段

| 字段                   | 用途                             |
| ---------------------- | -------------------------------- |
| `id`                   | 人员主键                         |
| `name`                 | 人员名称                         |
| `type`                 | 人员分类字符串（兼容保留字段名） |
| `coverUrl`             | 列表封面图 URL，语义化字段       |
| `avatarUrl`            | 兼容字段，当前与 `coverUrl` 相同 |
| `location`             | 演绎地点                         |
| `badge`                | 封面左上角实时渲染的标签         |
| `tags`                 | 下方标签数组，前台最多展示前四项 |
| `summary`              | 列表卡片两行描述                 |
| `detail`               | 详情内容                         |
| `sortOrder` / `status` | 排序及启用状态                   |

数据库仍以 `avatarAssetId` 关联媒体，后台展示名称为“列表封面图”；`location`、`badge` 新增为默认空字符串的兼容字段，`summary` 与 `tagsJson` 继续保留。标签输入应 trim、去空、去重，并且只 JSON 序列化一次。

## 参考图与最终布局令牌

- 参考图：`docs/design/reference-artists.png`，`853 × 1844` px。
- 设计宽度：`750rpx`。
- 页面左右留白：`20rpx`。
- 双列卡片：`345rpx` 宽，`20rpx` 列间距；固定总高 `436rpx`，行间距 `18rpx`。
- 封面：`345rpx × 240rpx`，`aspectFill`，仅卡片顶角使用 `16rpx` 圆角。
- 卡片：白底、`16rpx` 圆角、浅边框；正文 `196rpx` 固定高度并 `overflow: hidden`。
- 搜索/筛选控件高度：`54rpx`；页面底部只保留安全区留白，不复制原生 tabBar。
- H5 截图使用 `427 × 922` CSS px、`deviceScaleFactor: 2`，当前人员页输出 `854 × 1844` px；微信端继续以状态栏及胶囊实测值计算顶部安全区。
- 导航标题为 `32rpx`，卡片名称/角色/地点为 `28rpx`/`20rpx`/`20rpx`，单行标签为 `14rpx`，以避免四个中文标签被截断。
- 标签只占一行；单个标签省略，旧数据超过四项时截断到前四项。
- 描述以 `line-height: 30rpx` 和 `height: 60rpx` 固定两行，同时使用 `display: -webkit-box`、`-webkit-box-orient: vertical`、`-webkit-line-clamp: 2`、`overflow: hidden`、`text-overflow: ellipsis`。

参考图采样并归一化为下列页面 SCSS 令牌（文字抗锯齿像素不作为取样源）：

| SCSS 变量           | 值                                  | 用途                         |
| ------------------- | ----------------------------------- | ---------------------------- |
| `$page-background`  | `#FFFFFF`                           | 页面背景                     |
| `$primary-text`     | `#24211E`                           | 姓名、标题                   |
| `$secondary-text`   | `#817A73`                           | 描述、地点                   |
| `$accent-orange`    | `#DF7F34`                           | 类型、定位和筛选强调色       |
| `$tag-background`   | `#FFF5E9`                           | 下方标签、筛选背景           |
| `$tag-text`         | `#8C6037`                           | 标签文字                     |
| `$search-border`    | `#F1DDCB`                           | 搜索框边框                   |
| `$filter-background`| `#FFF5EA`                           | 筛选按钮背景                 |
| `$card-border`      | `#F0EEEB`                           | 卡片边框                     |
| `$card-shadow`      | `0 8rpx 18rpx rgba(53, 42, 30, .08)` | 卡片投影                     |

## 切图资源

执行命令：

```bash
pnpm assets:slice:artists
```

脚本 `scripts/slice-artist-assets.ts` 固定读取参考图，且会验证参考图尺寸、裁切边界、输出尺寸以及旧标签被裁切排除。它稳定输出 6 张 `690 × 480` PNG 照片资源和清单：

- `apps/miniapp/src/assets/generated/artist-cover-01.png`
- `apps/miniapp/src/assets/generated/artist-cover-02.png`
- `apps/miniapp/src/assets/generated/artist-cover-03.png`
- `apps/miniapp/src/assets/generated/artist-cover-04.png`
- `apps/miniapp/src/assets/generated/artist-cover-05.png`
- `apps/miniapp/src/assets/generated/artist-cover-06.png`
- `docs/design/artist-assets-manifest.json`

每个资源只包含照片区域；姓名、地点、标签、描述、皇冠和定位图标均由实时 UI 渲染。每张封面会以同照片中的相邻背景完成原左上徽标区域的局部修复，避免图片内旧徽标与动态徽标重叠。

作为历史截图资源的兼容保护，卡片动态徽标使用不透明底色，且其位置与最小宽高覆盖旧截图徽标的完整投影范围；即使用户尚未重跑切图脚本，也不会出现徽标重影。

## SQLite 与接口约定

SQLite 初始化需先用 `PRAGMA table_info` 检查 `location`、`badge`，缺失时执行一次带空字符串默认值的 `ALTER TABLE ADD COLUMN`；该过程应可重复执行且不影响历史人员及其 `avatarAssetId` 媒体关联。人员列表支持 `type`、`q`、`location`、`tag`，仅返回启用项，以 `sortOrder ASC, id ASC` 排序。

## 视觉复核产物

以下文件由 `pnpm e2e --grep '人员列表设计复核截图与参考差异图'` 实际生成：

- `docs/design/actual-artists-host.png`
- `docs/design/actual-artists-singer.png`
- `docs/design/actual-artists-actor.png`
- `docs/design/diff-artists-host.png`

已完成多轮截图校准：第二轮修正为当前人员页根节点截图并将 H5 输出设为 2×；后续校准了顶部安全区、封面高度、正文排版与标签字号。最新需求将三类人员页定义为子页面，因此参考图中的底部导航不在该页面渲染范围；对比时不得遮罩搜索栏或卡片。H5 不会呈现微信原生胶囊，系统字体字形与状态栏高度仍会产生轻微平台差异。
