# 人员详情参考素材

## 来源

- 原始截图：`reference-artist-detail-original.png`
- 尺寸：`898 × 1751`
- SHA-256：`49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39`
- 坐标辅助图：`artist-detail-coordinate-grid.png`
- 裁切清单：`artist-detail-assets.json`
- 汇总预览：`artist-detail-assets-contact-sheet.png`

`pnpm assets:slice:artist-detail` 会校验原图尺寸与 SHA-256，然后确定性地产出 26 个资源。JSON 清单记录每个来源坐标、输出尺寸和 MD5；同一输入重复运行不会写入时间戳或随机字段。

## BANNER 处理

三张 BANNER 均来自同一张参考截图的顶部活动现场，并保留右侧人物、头部、麦克风和身体。原截图含状态栏、返回按钮、微信胶囊、姓名、类型、宣传语和标签，因此不能直接把顶部整块当作图片：

- 左侧 UI 区用参考图实测的深棕色重新构建不透明渐变，随后在人物前自然渐隐。
- 右上系统状态与胶囊只用同一参考图的纯幕布区域局部修补。
- manifest 的 `excludedOverlayRegions` 明确记录所有覆盖区域，`uiTextExcluded` 标记三个 BANNER 均不含可见 UI 文字。
- 未使用生成式图片，未裁入整张页面、整张卡片或底部操作区。

## Seed 用途

切片资源全部通过稳定 `SeedRecord` key 注册为 `MediaAsset`。林然使用三张 BANNER 与五张现场图片；案例示例使用现场图片和一个确定性的 1 秒 H.264 静音演示片段。富文本在媒体写库后才按实际 ID 生成 `data-media-asset-id`，不依赖自增 ID。
