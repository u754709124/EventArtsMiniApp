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
`pnpm assets:slice`。首次在 sandbox 中运行 `tsx` 会因本地 IPC pipe 权限失败；使用批准后的同一命令执行成功。Stage 5 为设计复核补充 TabBar 图标后再次执行成功。

## 验收清单
- [x] 输出图片满足目标尺寸
- [x] manifest 记录尺寸校验结果

## 已完成事项
- 已保存参考图到 `docs/design/reference-home.png`，原图尺寸为 `853x1844`。
- 已创建 `scripts/slice-home-assets.ts`，使用 Sharp 从参考图裁切并 cover resize 到目标尺寸。
- 已生成 20 个测试资源到 `apps/miniapp/src/assets/generated`，包含首页 Banner、菜单图标、案例封面、占位图和 4 组 TabBar 普通/选中图标。
- 已生成 `docs/design/assets-manifest.json`，其中 `valid: true`，所有输出尺寸校验通过。
- 裁切策略：Banner 使用参考图主视觉区域；菜单图标使用参考图第一行服务图标和第二行联系我们图标；案例封面使用参考图三张精选案例封面；占位图使用相同视觉区域加模糊和暖色弱化处理。
- TabBar 图标使用脚本内 SVG 线性图标渲染为 PNG，保证 H5 和微信小程序端都有明确的底部图标资源。

## 对应 git commit hash
39469eb

## 已知问题或设计取舍
参考图分辨率低于部分输出目标，脚本使用裁切、扩展和 cover resize 保证尺寸。生成资产适合本地 seed、测试和视觉还原，不作为最终商用摄影素材。TabBar 图标为线性功能图标，不来自参考图原始切图。
