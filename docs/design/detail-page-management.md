# 独立详情页后台管理设计

## 目标

后台将详情页作为独立内容实体管理。公告、首页 BANNER、人员和案例只保存可空 `detailPageId`，不再内嵌详情配置；运营在“详情页管理”中创建、编辑、预览和查看引用，再在业务表单中选择引用。

## 导航与路由

侧栏新增一级入口“详情页管理”，路由为：

- `/detail-pages`：详情页列表。
- `/detail-pages/new`：新建详情页。
- `/detail-pages/:id/edit`：编辑详情页。

业务表单中的“新建”按钮优先打开 `/detail-pages/new?returnToken=...` 新标签页；保存成功后通过 `BroadcastChannel` 或 `window.postMessage` 通知原表单刷新并尽可能自动选择新详情页。原表单窗口获得焦点时也会刷新选项，作为跨标签回传的后备。

## 列表页

列表页 testid 为 `detail-page-management`。能力包括：

- 按 ID 或名称搜索：`detail-page-search`。
- 按类型筛选：`detail-page-type-filter`。
- 新建详情页：`detail-page-create`。
- 表格展示 ID、名称、类型、BANNER 数量、正文媒体数量、引用次数、更新时间和操作。
- 名称和“编辑”进入编辑页。
- 被引用详情页的删除按钮禁用；删除前仍由 API 和数据库外键重新检查。
- 引用次数由 API 统计四张业务表的 `detailPageId`，不依赖前端遍历业务列表。

## 设计器布局

设计器采用桌面左右布局：

- 左侧为移动端实时预览，保持在滚动时可见。
- 右侧为详情页配置表单。
- 右侧顶部为吸顶工具栏 `detail-designer-toolbar`，包含返回、保存状态和保存按钮 `detail-designer-save`。
- 存在未保存修改时，返回列表、侧栏切换、退出登录和浏览器刷新/关闭都会触发确认，避免表单草稿被静默丢弃。

字段顺序固定为：

1. 详情页 ID：新建显示“保存后自动生成”，保存后显示真实 ID。
2. 详情页名称：必填，最多 100 字，可重名，业务选择时和 ID 一起展示。
3. 详情页类型：必须主动选择，来源于 shared registry。
4. 当前类型配置项。

`banner_rich_text` 显示 Hero、BANNER 多图排序和富文本；`rich_text` 只显示富文本。切换到单富文本前确认清除 BANNER 关系，富文本保留，只有保存后才写入数据库。

## 实时预览

左侧 `DetailPageLivePreview` 对表单草稿做防抖，并调用 `POST /api/admin/detail-pages/preview`。预览 API 使用正式清洗、媒体校验、URL 规范化、serializer 和 blocks parser，不直接执行未清洗 HTML。

预览保持与小程序公共详情结构一致：

- BANNER + 富文本显示轮播、Hero、页码、首卡覆盖、图片和视频。
- 单富文本没有 BANNER、页码、Hero、BANNER 占高或负重叠。
- 预览失败只显示错误，不清空右侧草稿。

## 统一引用控件

`DetailPageReferenceField` 是四类业务表单共用控件，结构固定为：

```text
[ 请选择详情页                         ▼ ] [新建] [跳转页面]
```

行为：

- 字段值为 `detailPageId`。
- 支持清空、按 ID 或名称搜索、服务端 options 查询。
- 选项展示 `#ID 名称 [类型]`。
- 已选详情页不在当前选项页时，会按 ID 补拉详情页轻量信息。
- 搜索请求带序号门控，旧响应不能覆盖新搜索结果。
- 已选详情页被删除或失效时，控件会移除过期选项、提示重新选择并清空字段值。
- 未选择时“跳转页面”禁用。
- 选择后“跳转页面”打开 `/detail-pages/:id/edit` 新标签页。
- “新建”打开新标签页，避免丢失当前业务表单未保存内容。

稳定 testid：

- `detail-page-reference-select`
- `detail-page-reference-create`
- `detail-page-reference-jump`

## 业务表单接入

公告、首页 BANNER、人员和案例表单都只呈现一个“详情页”字段并使用 `DetailPageReferenceField`。

- 公告保留概述、内容、显示时间、排序和状态。
- BANNER 保留标题、图片、切换时间、排序和状态；不再编辑 `linkType/linkTarget`。
- 人员保留列表封面、地点、标签、描述、排序和状态；不再内嵌详情类型、BANNER、富文本或预览。
- 案例保留封面、摘要、日期、地点、精选和排序；不再内嵌详情类型、BANNER、富文本或旧详情媒体配置。

保存 payload 只包含基础字段和 `detailPageId: number | null`。详情内容只能在独立详情页设计器修改。

## 删除保护与引用查看

详情页列表和编辑页都展示引用次数。编辑页显示“被引用 N 次”，并列出公告、首页 BANNER、人员和案例来源。删除流程先查引用，存在引用时返回受控 409；并发情况下 SQLite `ON DELETE RESTRICT` 外键仍会阻止删除。

## 验证

2026-07-11 最终验证：

- `pnpm e2e`：37/37 passed，覆盖后台详情页管理、业务引用字段、详情页创建、人员引用、案例引用/清空和资源删除保护。
- `pnpm release:check`：通过，覆盖 lint、unit、E2E、API/Admin/H5/WeApp 构建。
