# 人员详情参考素材

## 来源

- 原始截图：`reference-artist-detail-original.png`
- 尺寸：`898 × 1751`
- SHA-256：`49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39`
- 坐标辅助图：`artist-detail-coordinate-grid.png`
- 裁切清单：`artist-detail-assets.json`
- 汇总预览：`artist-detail-assets-contact-sheet.png`

仓库内的 `reference-artist-detail-original.png` 是默认权威输入，因此全新 checkout 和 CI 不依赖剪贴板临时文件。需要替换来源时可设置 `ARTIST_DETAIL_REFERENCE_SOURCE`；脚本先校验外部文件的尺寸和 SHA-256，再更新仓库副本。来源与副本指向同一文件时不会执行自拷贝。

`pnpm assets:slice:artist-detail` 会校验原图尺寸与 SHA-256，然后确定性地产出 26 个资源。JSON 清单记录每个来源坐标、输出尺寸、MD5，以及 BANNER 修补的来源裁区、目标区域、输出区域、混合模式和 feather mask 参数；同一输入重复运行不会写入时间戳或随机字段。

## BANNER 处理

三张 BANNER 均来自同一张参考截图的顶部活动现场，并保留右侧人物、头部、麦克风和身体。原截图含状态栏、返回按钮、微信胶囊、姓名、类型、宣传语和标签，因此不能直接把顶部整块当作图片：

- 左侧 UI 区用参考图实测的深棕色重新构建不透明渐变，随后在人物前自然渐隐。
- 右上系统状态与胶囊使用同一参考图最右侧 `138 × 170px` 的纯幕布区域一次性修补；向左镜像扩展 `80px` 后保持原像素尺度，不再把 `48px` 窄条拉伸三倍。左侧 `55px`、底部 `35px` 使用 smoothstep feather mask 渐隐，消除矩形边界。
- manifest 的 `patches` 完整记录 source crop、source-frame/output target、`over` blend 与四边 feather 参数；测试会直接读取输出像素计算修补边界相对邻域的梯度不连续比（上限 `1.75`），而非只信 `uiTextExcluded` 标记。
- 未使用生成式图片，未裁入整张页面、整张卡片或底部操作区。

## Seed 用途

切片资源全部通过稳定 `SeedRecord` key 注册为 `MediaAsset`。林然使用三张 BANNER 与五张现场图片；案例示例使用现场图片和一个确定性的 1 秒 H.264 静音演示片段。富文本在媒体写库后才按实际 ID 生成 `data-media-asset-id`，不依赖自增 ID。
