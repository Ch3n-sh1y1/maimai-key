美术占位说明
============

标题界面右侧预留了一个 ARTWORK SLOT（600×800 竖图）。

替换方法：
  public/art/title-placeholder.svg
可以替换成同名 SVG，或换成 PNG/JPG 后修改 src/app/ui.ts 里的
  <img src="art/title-placeholder.svg" ...>
以及打包时 public/art 会自动复制到 dist/art。

建议尺寸：600×800（3:4），主体尽量放在中间，四周留 40px 安全边。
不要包含你没有版权的角色/曲绘。

其他预留位置（代码中的 class）：
- .title-art          标题界面右侧插画卡
- .select-screen::before  选曲页背景圆环装饰
- 游戏内 HUD          由 src/app/play-renderer.ts 绘制，可在 buildHud()/layoutHud() 中扩展
