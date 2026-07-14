# 公共详情页系统设计与视觉证据

## 架构背景

详情页已从 owner-bound 配置升级为独立、自包含、可复用的内容实体。公告、首页 BANNER、人员和活动案例只保存可空 `detailPageId` 外键；详情页自身保存名称、类型、Hero、BANNER、富文本、媒体关系和 blocks。`packages/shared` 定义注册表及传输契约，API 负责持久化、安全清洗、媒体关系和 blocks 转换，Admin 负责独立详情页管理与引用选择控件，Taro 通过公共 `/pages/detail/index?id=<detailPageId>` 渲染详情。

旧 `ownerType/ownerId`、`Artist.detail`、`ActivityCase.detail`、`ActivityCase.legacyMediaJson` 和 BANNER `linkType/linkTarget` 保留为 deprecated 兼容字段。新运行时不以它们作为导航或详情来源；客户端兼容 `detail` 从所引用详情页的 `richTextHtml` 派生。

## 类型注册表与 owner 规则

`packages/shared/src/detail-pages.ts` 的注册表拥有类型中文名、renderer key、动态字段、BANNER 数量、允许媒体类型和 schemaVersion。

| 枚举值             | 中文名          | rendererKey      | 字段与约束                                           |
| ------------------ | --------------- | ---------------- | ---------------------------------------------------- |
| `banner_rich_text` | BANNER + 富文本 | `bannerRichText` | 宣传语 trim 后非空；1–6 张不重复图片；富文本语义非空 |
| `rich_text`        | 单富文本        | `richText`       | 仅富文本；宣传语为空；`banners` 必须为空             |

`ownerType/ownerId` 仅用于旧数据审计和迁移回填。运行时引用关系是业务表的真实 FK：`announcements.detailPageId`、`banners.detailPageId`、`artists.detailPageId`、`activity_cases.detailPageId`、`articles.detailPageId`，均允许为空并使用 `ON DELETE RESTRICT` 保护被引用详情页。

## 数据库与传输契约

- `detail_page_configs`：name、pageType、完整 Hero 字段、schemaVersion、richTextHtml、deprecated owner 与时间戳。
- `detail_page_banner_media`：BANNER 图片关系与 `sortOrder`；配置和媒体联合唯一。
- `detail_page_content_media`：清洗后 HTML 中的图片/视频引用；配置和媒体联合唯一。

Admin 创建/更新独立详情页时提交：

```ts
type DetailPageInput =
  | {
      type: "banner_rich_text";
      name: string;
      hero: {
        title: string;
        typeLabel: string;
        subtitle: string;
        badge: string;
        tags: string[];
        location: string;
        metaItems: Array<{ label: string; value: string }>;
      };
      bannerAssetIds: number[];
      richTextHtml: string;
    }
  | {
      type: "rich_text";
      name: string;
      richTextHtml: string;
    };
```

业务表单只提交 `detailPageId: number | null`。未绑定时前台入口不可点击，也不会回退旧 `linkType/linkTarget` 或 owner route。

API 返回稳定 DTO：

```ts
type DetailPageConfigDto = {
  id: number;
  name: string;
  type: "banner_rich_text" | "rich_text";
  typeLabel: string;
  rendererKey: "bannerRichText" | "richText";
  schemaVersion: number;
  hero: {
    title: string;
    typeLabel: string;
    subtitle: string;
    badge: string;
    tags: string[];
    location: string;
    metaItems: Array<{ label: string; value: string }>;
  };
  heroSubtitle: string;
  banners: Array<{
    id: number;
    assetId: number;
    url: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }>;
  richTextHtml: string;
  blocks: Array<
    | { type: "richText"; html: string }
    | {
        type: "video";
        assetId: number;
        url: string;
        posterUrl: string | null;
        width: number | null;
        height: number | null;
      }
  >;
};
```

`rich_text` 响应的 Hero 为空、`heroSubtitle` 是空字符串、`banners` 是空数组。公共客户端详情接口为 `GET /api/client/detail-pages/:id`。

## Admin 动态表单与 Tiptap 决策

人员和案例复用同一个 `DetailPageConfigFields`。未选类型时不挂载编辑器；选择类型后依据注册表显示宣传语、BANNER 和富文本字段。切到单富文本前确认清除 BANNER，隐藏字段不会进入保存 payload。预览调用 `POST /api/admin/detail-pages/preview`，因此与实际保存共用服务端清洗和 serializer。

选择 Tiptap 3 是因为它提供受控 React 集成、结构化 extension、自定义图片/视频 node、工具栏状态和明确销毁生命周期。编辑器保持单实例；`value` 外部变化通过无 update 事件的 `setContent` 回填，StrictMode 下不会重复初始化。图片和视频都从统一媒体库选择：

1. 媒体弹窗返回完整 `MediaAssetDto`。
2. 编辑器只信任 API 回填或 picker 选择的资源。
3. 自定义 node 保存整数 `data-media-asset-id`，本地预览 `src` 只用于编辑体验。
4. 图片 node 保留替代文本与对齐；视频 node 独立保留媒体 ID。
5. 保存时 API 重新查库、验证真实媒体类型并重写规范 URL。

## HTML/CSS 安全白名单

API 使用 `sanitize-html` 清洗并用 `parse5` 做结构遍历、语义空判断、媒体规范化和 blocks 切分，不使用正则解析 HTML。

允许标签：`p`、`div`、`section`、`span`、`strong`、`em`、`u`、`s`、`h1`–`h6`、`ul`、`ol`、`li`、`blockquote`、`hr`、`br`、`a`、`img`、`video`、`source`。

允许 class：`ea-detail-card`、`ea-section-title`、`ea-section-body`、`ea-intro`、`ea-advantage-grid`、`ea-advantage-item`、`ea-case-grid`、`ea-case-item`、`ea-process-row`、`ea-process-item`、`ea-review-list`、`ea-review-item`、`ea-review-main`、`ea-review-image`、`ea-two-column`、`ea-calendar-card`、`ea-faq-card`、`ea-media`、`ea-image`、`ea-video`、`ea-media-block`、`ea-align-left`、`ea-align-center`、`ea-align-right`。

允许 style 属性：`color`、`background-color`、`font-size`、`font-weight`、`font-style`、`text-decoration`、`text-align`、`line-height`、`margin`、`padding`、`border`、`border-radius`、`width`、`max-width`、`height`、`max-height`。每项还有单位和数值上限；不允许负尺寸、`expression`、`url()` 或不合理尺寸。链接协议仅 `http`、`https`、`mailto`、`tel`；媒体拒绝 `data:`、`blob:`、`file:`、`wxfile:` 与临时文件路径。

媒体节点必须包含正整数 `data-media-asset-id`。服务端查库后要求 `img` 引用图片、`video` 引用视频，并把客户端 `src` 重写为 `MediaAsset.url`。`script`、事件属性和危险协议不会进入持久化 HTML。

## 媒体生命周期与 blocks 转换

保存事务先解析 discriminated union，再批量查找全部 BANNER/内容媒体：BANNER 验证图片类型、数量、唯一性与顺序；富文本清洗后重新提取引用。服务层 upsert 配置，并同步新增、保留、删除 BANNER 与内容关系。切到 `rich_text` 会清空 BANNER 关系。媒体删除检查两张关系表，因此仍被任一详情引用的资源不能删除；删除 owner 时级联清除配置和关系，不留下孤儿。

parser 深度遍历清洗后的 fragment。连续非视频节点序列化为 `richText` block；遇到任意嵌套层级的 `video` 时先 flush 前文，生成独立 video block，再继续保留后文。Taro 因而使用 `RichText` 展示安全 HTML、使用原生 `Video` 展示视频，视频有 controls、无 autoplay/loop、尺寸未知时采用 16:9，并提供失败重试。

## SQLite 兼容迁移

初始化器先创建兼容基础表，再执行幂等迁移。已有 `detail_page_configs`、BANNER 关系和正文媒体关系优先保留并逐行校验；旧 owner-bound 配置会回填到对应业务表的 `detailPageId`，同时补齐名称和 Hero 字段。旧 BANNER `linkType/linkTarget` 只在目标业务对象已经拥有详情页时安全映射，否则保持 `detailPageId = null`。迁移 ledger 防止重复执行；升级前必须同时备份 SQLite 和 `uploads`。

## 公共 Taro renderer 与 adapters

`DetailPageRenderer` 以共享 `rendererKey` 查找 exhaustively typed registry。`BannerRichTextRenderer` 渲染排序 Swiper、页码、覆盖式导航、Hero 与负重叠内容；单图不 circular。`RichTextRenderer` 只渲染正常导航和内容，完全没有 BANNER、Hero、页码、BANNER skeleton、高度或负 margin DOM。

公共详情路由直接使用详情页 DTO 内的 Hero；旧人员/案例详情路由只作为兼容跳板，读取业务 `detailPageId` 后 redirect 到 `/pages/detail/index`，无引用时显示“暂无详情”。路由只负责取数、错误分类、ID race gate 和 PV；切换 ID 立即清空旧 state，迟到响应不能覆盖新数据。

返回按钮优先 `navigateBack`，没有页面栈或失败时人员回分类 Tab、案例回案例列表。错误和配置缺失状态提供“重新加载”；不存在、停用、未知类型和语义空内容有各自文案。

## 参考资产与测量方法

权威参考是 `docs/design/reference-artist-detail-original.png`（`898 × 1751`，SHA-256 `49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39`）。`pnpm assets:slice:artist-detail` 读取 manifest，生成坐标网格、26 个确定性资源和 contact sheet。人物 BANNER 只保留活动现场与人物；左侧暗色层、状态栏/胶囊修补过程记录在 `artist-detail-assets.json`，没有把文字、卡片或系统 UI 切入业务图片。

| 资源组           | 数量 | 输出                                       |
| ---------------- | ---: | ------------------------------------------ |
| 林然 BANNER      |    3 | balanced / close / wide，均为 `1420 × 580` |
| 服务优势图标     |    4 | 经验、双场景、控场、普通话                 |
| 代表案例图       |    5 | 婚礼、发布会、年会、草坪婚礼、答谢宴       |
| 服务流程图标     |    5 | 沟通、方案、档期、执行、回访               |
| 客户头像与评价图 |    4 | 两张头像、两张现场图                       |
| 通用小图标       |    4 | 皇冠、定位、日历、问号                     |
| 演示视频         |    1 | 确定性 1 秒 H.264 静音片段                 |

坐标按原图像素记录，换算使用 `750 / 898 = 0.83519rpx/px`。颜色为指定无文字小区域的代表像素/主色；JPEG/缩放抗锯齿会产生约 1–3 RGB 级波动。文字“墨迹高度”不是 CSS em，表中同时给出视觉测量和 SCSS 目标 token。

| 项目           | 参考图测量（原图坐标/像素）                             | 目标 token                        |
| -------------- | ------------------------------------------------------- | --------------------------------- |
| 页面背景       | `(400,700) #fcfbfa`、`(20,1600) #fefefe`                | `$detail-background: #fdfcfa`     |
| 卡片背景       | `(400,590) #fefefe`，主色 `#ffffff`                     | `$detail-surface: #fff`           |
| 主文字         | section 标题深色像素主簇约 `#111111`                    | `$detail-text`                    |
| 正文           | 简介行深灰主簇约 `#666666`                              | `$detail-body`                    |
| 辅助文字       | 标签/元数据代表像素约 `#8c8170`                         | `$detail-muted`                   |
| 金橙色         | 竖线 `(58,470) #e5893d`                                 | `$detail-gold: #e5893d`           |
| 标签背景       | `(90,300) #fdf6ed`                                      | `$detail-tag-background: #fdf6ed` |
| 标签文字       | 深棕灰代表值约 `#6f6354`                                | `$detail-tag-text`                |
| 卡片边框       | 白底边缘约 `#f1ebe4`                                    | `$detail-border`                  |
| 阴影           | 卡片外 8–30px 内约 4%–8% 深棕灰                         | `$detail-shadow`                  |
| 页码背景       | 参考未提供独立纯色区；按暗棕遮罩约 `rgba(31,22,14,.64)` | `$detail-counter-background`      |
| 返回按钮背景   | `(30..80,64..112)` 白色主簇，约 94%–98% 不透明          | `$detail-back-background`         |
| BANNER 高度    | 背景底约 `482px`                                        | `$detail-banner-height: 424rpx`   |
| 页面左右边距   | 左边 `29px`、右边约 `27px`                              | `$detail-gutter: 24rpx`           |
| 卡片圆角       | 顶角转折约 `21–24px`                                    | `$detail-card-radius: 20rpx`      |
| 卡片内边距     | 边框到标题竖线约 `26px`                                 | `$detail-card-padding: 24rpx`     |
| 卡片间视觉间距 | 阴影边缘约 `2–8px`                                      | `$detail-card-gap: 8rpx`          |
| 首卡覆盖距离   | BANNER 底 `482px`、首卡顶 `430px`                       | `$detail-overlap: 42rpx`          |
| 姓名           | 墨迹高约 `54px`                                         | `48–50rpx` font token             |
| 类型           | 墨迹高约 `31px`                                         | `28–30rpx`                        |
| 宣传语         | 墨迹高约 `25px`                                         | `25–27rpx`                        |
| section 标题   | 墨迹高约 `27px`                                         | `$detail-section-title-size: 28rpx` |
| 标题左竖线     | 棕金装饰不高于单行文字                                  | inline marker `height/max-height: 1em` |
| 正文           | 墨迹高约 `20–22px`                                      | `26–28rpx`                        |
| 正文行高       | 相邻基线约 `31px`                                       | `1.55–1.72`，以运行截图复核       |
| 图片/视频圆角  | 案例图转角约 `12–16px`                                  | `$detail-media-radius: 14rpx`     |

最后一列是从实测映射到整数 rpx token 的范围，不等于已证明像素一致；必须以真实 H5 第二轮截图决定最终取值。

## H5 与微信端差异

- H5 视觉证据固定 viewport `427 × 922`、DPR 2；微信端以 `statusBarHeight` 和胶囊矩形计算导航安全区。
- BANNER 以 `424rpx` 为最小高度而非固定最终高度；Hero 参与正常流并由真实内容自然撑高，顶部复用导航安全区，底部显式预留 `42rpx` 首卡重叠量加 `24rpx` 可见间距。Swiper、遮罩、导航和计数器绝对铺在最终 BANNER 高度内。
- Admin 的 375px 移动端预览按半比例镜像该流式契约：`212px` 最小高度、`72px 115px 33px 22px` 内容 padding、覆盖导航 `20px + 44px`、首卡负重叠 `21px`；富文本标题为 `14px`，对应小程序 `28rpx`。
- 标题由两端共用的可信展示增强器插入 marker/content 兄弟节点，`h1` 使用 flex 中心对齐，marker 的 `height/max-height` 均为 `1em` 且不再使用 `text-top` 或负 margin；图片继续合并 `width/max-width: 100%` 与 `height: auto`，不修改存储 HTML 或 DTO。
- H5 测试通过 `globalThis.__TARO_DETAIL_E2E_FIXED__ = true` 固定第一张 BANNER 并关闭自动轮播；正式运行多图间隔 6500ms。
- 微信小程序端公共详情页启用“发送给朋友”分享能力，并在右下角渲染独立悬浮圆形分享按钮；按钮使用 `Button openType="share"`，不绘制自定义分享面板。
- 分享按钮图标来自用户提供的 `icon_font.png`，项目内副本为 `apps/miniapp/src/assets/generated/icon-share.png`，保留 64×64 RGBA、透明背景和深灰黑上传/分享图形。
- 分享卡片路径固定为 `/pages/detail/index?id=<detailPageId>`；标题优先使用当前详情 Hero 标题，空值回退详情页名称；`banner_rich_text` 使用排序后的首张有效 BANNER 作为卡片图，无可靠图片时省略 `imageUrl`。
- 加载中、错误、非法 ID、DTO 与当前路由 ID 不一致时不显示可用悬浮分享按钮，也不生成错误详情深链。快速切换详情 ID 时仍由现有 race gate 清空旧状态，分享 payload 只来自当前成功 DTO。
- H5 生产页面不模拟微信原生分享面板，也不渲染不可用的业务分享按钮；H5 自动化只验证无运行时异常、无占位和公共分享模型。
- H5 的 `env(safe-area-inset-bottom)` 常为 0；微信端保留真实设备安全区。两端最后一张卡片后都只允许正常内容间距、安全区和约 24–32rpx 自然留白。

## 已移除操作

公共详情页允许且仅允许右下角悬浮微信原生分享按钮。人员和案例详情仍不得出现收藏、在线咨询、立即预约、固定底部业务栏、导航区分享按钮、第二个分享入口或旧底栏 spacer。该限制同时由公共 renderer 结构、静态单元测试和 H5 E2E 文本/选择器/尾部几何断言覆盖。

## 视觉截图、overlay 与 diff

Playwright 用稳定 seed 名称/标题解析 ID，等待 `document.fonts.ready` 和所有图片 settled，再生成：

- `docs/design/actual-artist-banner-rich-text.png`
- `docs/design/actual-artist-rich-text.png`
- `docs/design/actual-case-banner-rich-text.png`
- `docs/design/actual-case-rich-text.png`
- `docs/design/overlay-artist-detail.png`
- `docs/design/diff-artist-detail.png`
- `docs/design/detail-page-visual-evidence.json`（viewport、对齐规则与 SHA-256）

可复现命令：

```bash
pnpm e2e -- --project=miniapp-h5 --grep "四种详情页视觉截图与人员详情对齐差异图"
```

对齐方法不拉伸比例：把参考图按实际截图宽度等比缩放，实际图和参考图都从顶部对齐，再裁到两者较短高度；不遮罩 BANNER、Hero、返回按钮、首卡、富文本、边距或底部。overlay 使用 50% alpha，diff 使用逐像素 difference。H5 与微信状态栏、安全区、字体渲染及内容高度客观不同，因此这些文件用于定位差异，不宣称 pixel parity。

当前运行证据必须以文件真实存在和 JSON hash 为准；不能以文档中的路径替代产物。2026-07-11 最终审计中，`pnpm e2e` 已真实执行通过 37/37，`pnpm release:check` 已真实执行通过并覆盖 lint、unit、E2E、API build、Admin build、H5 build 和 WeApp build。E2E 运行已重新生成详情页视觉截图、首页截图和 `docs/design/detail-page-visual-evidence.json`，当前哈希以该 JSON 文件为准。

2026-07-12 分享入口更新后，`pnpm --filter miniapp test`、`pnpm lint`、`pnpm test`、详情页 H5 E2E 命令、`pnpm --filter miniapp build:h5`、`pnpm build:weapp` 与 `pnpm release:check` 均真实执行通过。微信开发者工具或真机“发送给朋友”卡片点击直达仍需人工验证，自动化环境未宣称该端到端链路已通过。

## 新增第三种 renderer 的精确八步

1. 在 `packages/shared/src/detail-pages.ts` 扩展 shared 枚举值，并保持 owner 枚举不变。
2. 为新类型增加 definition、唯一 `rendererKey`、动态字段和 schemaVersion 类型定义。
3. 把新分支加入 `DetailPageInputSchema` 的 discriminated union，写清字段互斥和媒体约束。
4. 在公共 Admin `DetailPageConfigFields` 注册字段映射、预览与类型切换清理规则，不复制人员/案例编辑器。
5. 在 API serializer/parser/service 增加新分支、规范化、关系同步与 blocks 输出，必要时提供向后兼容 migration。
6. 在公共 Taro renderer registry 注册一个以新 `rendererKey` 为键的 renderer，并复用导航、内容、媒体和公共详情路由。
7. 增加 shared/API/Admin/Taro 单测、人员与案例 E2E、错误/迁移/媒体保护及视觉证据，再运行 H5 与 WeChat 构建。
8. 不修改人员、案例基础表单主体；owner 路由继续只做取数、状态、PV 和 Hero adapter。
