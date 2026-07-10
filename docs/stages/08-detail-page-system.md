# Stage 08 — 通用详情页系统

## 阶段目标

为人员与案例建立公共详情配置、服务端安全富文本、统一后台表单和 Taro 渲染器，并保留 SQLite 历史数据兼容能力。

## 当前基线

- 开始分支：`codex/phase-one-delivery`
- 规格审计基线：`656a562629948cc4c8df5847ddd7878aace60342`
- 模型分配说明提交：`71ecd2cd8aa55fb965af446b70df9692664b3f20`
- 持久计划：`docs/superpowers/plans/2026-07-11-unified-detail-page-system.md`

## 已完成：共享契约与后端

- 两种页面类型和 owner 注册表、Zod discriminated union、统一 DTO、rendererKey。
- Prisma 三张公共详情表和 SQLite 同构 DDL、索引、外键、迁移台账。
- `sanitize-html` + `parse5` 清洗、媒体 URL 重写、危险协议/样式限制、语义空内容检测。
- HTML 图片/视频关系提取，嵌套视频按原顺序拆为 `richText/video/richText` blocks。
- 旧 Artist/ActivityCase 文本与有序媒体事务迁移、幂等、防覆盖、回滚、孤儿审计。
- 事务化 DetailPageService、预览、人员/案例 CRUD、客户端详情 DTO、旧 `detail/media` 派生。
- BANNER/正文媒体引用计数、来源标签和删除保护。
- 幂等 seed 已覆盖两种人员与案例页面类型；林然为 3 图 BANNER 和完整参考富文本。案例 seed 视频资源将在素材阶段补齐。

## 当前验证证据

- `pnpm --filter @event-arts/shared test`：2 files / 19 tests passed。
- `pnpm --filter @event-arts/shared build`：通过。
- `pnpm --filter api test`：8 files / 73 tests passed。
- `pnpm lint`：通过。
- `pnpm test`：shared 19、admin 3、api 73，miniapp 无单测并按配置通过。

## 迁移覆盖

- 新库重复初始化。
- 旧人员纯文本转义和换行段落。
- 旧案例图片/视频顺序和重复资源消除。
- 已有新配置不覆盖。
- 多次迁移不重复。
- 非空不可解释 `legacyMediaJson` 整体回滚。
- 迁移后无多态 owner 孤儿。

## 待完成

- 参考图确定性切图、案例 seed 视频、contact sheet。
- 后台共用动态表单、BANNER 字段、Tiptap 富文本和移动端预览。
- Taro 公共 renderer、四种详情页面、视觉校准。
- Admin/H5 E2E、四张截图、overlay/diff、API/README/设计文档和全量发布验证。

## 已知取舍

- 旧数据库字段只读保留；新保存不双写，兼容响应从 DetailPageConfig 派生。
- blocks 始终从已清洗 HTML 派生，不写数据库。
- SQLite 多态 owner 无真实外键，通过公共服务和孤儿审计保证一致性。
