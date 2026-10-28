# 美术占位与替换指南

目前 UI 使用原创的 CSS/SVG 几何装饰，没有角色插画。以下位置已经预留，方便后续换成正式美术。

> 0.2.2 起玩家可以在主页面/游戏内直接拖入自己的照片作为背景，并通过平移/缩放选择裁切区域。本文件描述的是随包发布的默认美术资源替换方式。

## 标题插画位（已实现）

- 文件：`public/art/title-placeholder.svg`
- 尺寸：600 × 800（3:4 竖图）
- 位置：标题界面右侧 `.title-art` 卡片
- 替换：换掉这个 SVG，或改成 PNG/JPG 后同步修改 `src/app/ui.ts` 中的 `<img src="art/title-placeholder.svg">`
- 建议主体放在中间，四周留 40px 安全边；卡片会自动裁切为 3:4。

## 选曲页背景环

- CSS：`.select-screen::before`（`src/app/style.css`）
- 目前是 8 色 conic-gradient 圆环，透明度 0.055
- 如需角色/曲绘背景，可在此处叠加 `background-image`，或替换为 `public/art/select-bg.webp`
- 注意不要遮挡曲目列表和难度面板。

## 游戏内 HUD

- 绘制位置：`src/app/play-renderer.ts`
  - `buildHud()`：HUD 文本、面板、连击环
  - `layoutHud()`：位置与尺寸
  - `drawStatic()`：判定环、扇区色弧、键帽
- 预留扩展点：
  - 顶部左侧计分面板（`.hudPanel`）
  - 顶部中央连击环（`.comboRing`）
  - 键帽（初学者模式显示圆形键帽）
- 如需曲绘/背景图，可以在 `app.stage` 的最底层加 Sprite；建议 2560×1600 以内，并做 35% 以下暗化，避免干扰判定。

## 图标

- 应用图标：`build/icon.png` / `build/icon.ico`
- 生成脚本：`tools/gen_icon.py`（Pillow）
- 替换后重新执行 `python tools/gen_icon.py` 并重新打包。

## 其他

- 色彩 token 集中在 `src/app/style.css` 的 `:root`。
- 判定色：`src/core/balance.ts` 的 `JUDGMENT_COLORS`。
- 扇区色：`src/app/play-renderer.ts` 的 `SECTOR_COLORS`。
- 任何新增美术请确认版权；不要随包分发未授权的角色或曲绘。
