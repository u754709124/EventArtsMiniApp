# Stage 1 - Assets and Design

## 阶段目标
保存首页参考图，生成测试资源和资源清单。

## 功能范围
Sharp 切图脚本、生成图片、尺寸校验、设计记录。

## 主要文件
`scripts/slice-home-assets.ts`、`docs/design/reference-home.png`、`apps/miniapp/src/assets/generated`。

## 数据结构或接口
`docs/design/assets-manifest.json`。

## 测试方式
`pnpm assets:slice`。

## 验收清单
- [ ] 输出图片满足目标尺寸
- [ ] manifest 记录尺寸校验结果

## 已完成事项
待回填。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
参考图分辨率低于部分输出目标，脚本使用裁切、扩展和 cover resize 保证尺寸。
