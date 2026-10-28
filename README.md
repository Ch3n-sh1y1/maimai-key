# MaimaiKey — 键盘/触摸舞萌（Windows）

用键盘或触摸屏玩 maimai 风格节奏游戏。项目从零自研，包含判定引擎、Simai 谱面解析、WebGL 渲染、音频时钟与偏移校准；自带原创占位曲目与谱面，不包含任何版权素材。

> 这是社区向的键盘/触摸改编练习项目，与 SEGA 无关。请只使用你有权使用的音乐与谱面。

## 当前能力

- 8 键圆环 + Tap / Hold / Touch / Break / Slide 判定。
- 键盘化滑条：**路径键模式**（起点键 + 按顺序敲路点键）与**自动滑条**两种规则。
- 三种判定预设（键盘友好 / 标准 / 严格），可调音频、输入、显示三项偏移。
- 内置节拍器**延迟校准**向导：按空格测出输入偏移并一键应用。
- 音频时钟基于 `AudioContext.getOutputTimestamp()` 插值，判定只依赖音频时间与键盘事件时间戳。
- 240Hz 渲染（PIXI / WebGL），DOM 菜单，支持暂停、失焦自动暂停。
- 游玩界面三档：**初学者**（大键帽/HUD）、**普通**、**专业**（隐藏键位提示并弱化轨道）。
- **音频自动打谱**：选择/拖入 MP3、WAV、FLAC、M4A、AAC、OGG、Opus、WebM，自动测 BPM，一次生成 4 个难度；谱面可直接编辑后保存。
- 音频解码走 Chromium/Web Audio；平台加密缓存（网易云 NCM、QQ QMC/MFLAC/MGG、酷狗 KGM、酷我 KWM 等）**不解密**，会给出明确提示，需使用平台内合法导出的无加密文件。
- **自定义背景**：主页面和游戏背景都能拖入一张照片，自由平移/缩放选择裁切区域；支持 JPG、PNG、WebP、AVIF、GIF、BMP、SVG、HEIC/HEIF，本地持久化。
- **Esc 暂停菜单**：继续 / 重试 / 返回主页面 / 选曲；游戏左上角也有可点击的「暂停」按钮。
- **统一导航**：选曲/设置/自动打谱/结算的返回或主页统一放在左上角；退出/返回/暂停统一使用 Esc。\n- **开放式主菜单**：左侧菜单不再使用卡片/按钮边框，悬停文字时高亮、位移并出现下划线反馈；右侧保留游戏名主视觉。
- **0.3 输入与布局**：键盘模式把圆环展开为横向琴键，音符可从上往下或从下往上落；触摸屏模式使用八区多点触控。默认音符可视时间提高到 2.0 秒，下落速度更舒缓，可在设置里微调。Windows 触控板原生多点在 Electron 中不可读，本轮先做触屏，触控板保留单指鼠标回退。
- **发布版关闭开发者工具**：F12、Ctrl+Shift+I/J/C 和默认菜单都不会打开 DevTools；仅源码开发模式（`pnpm dev:electron`）可用。
- **曲库容错**：损坏的 pack.json/空谱面会被跳过并在选曲页提示，不再让整个游戏启动失败；导入/保存采用临时目录与原子 index 写入。
- **窗口安全**：阻止任意文件拖放导航、外部窗口和不可信 IPC；便携版曲库/设置保存在 exe 同级目录，标题和设置显示版本号。
- **曲包直接导入**：把 zip 拖进内容文件夹，重启游戏自动解压、转换并显示；不需要手改 index.json。
- 内置占位曲会首次启动时复制到用户曲库，之后可以像普通曲包一样查看/替换。
- 选曲、难度、结算、历史最佳、手动回放（最近 20 局）。
- 标题界面预留 600×800 美术位，详见 [docs/art-slots.md](docs/art-slots.md)。
- Electron 桌面壳、免安装目录、NSIS 安装器与便携版。

## 快速开始

```bash
pnpm install
pnpm gen:content     # 生成占位音频与谱面（仓库已包含生成结果）
pnpm dev             # 浏览器开发：http://localhost:5173
pnpm dev:electron    # Electron 窗口开发
```

构建与打包：

```bash
pnpm build           # 类型检查 + 产物输出到 dist/
pnpm preview         # 本地预览生产构建
pnpm package         # 生成 Windows 安装器与便携版（release/）
pnpm package:dir     # 只生成免安装目录
```

产物（v0.3.1）：

- `release/MaimaiKey-0.3.1-setup.exe`：NSIS 安装器（可选择目录）。
- `release/MaimaiKey-0.3.1-portable.exe`：单文件便携版，首次运行会解压到临时目录。
- `release/MaimaiKey-0.3.1-win-x64.zip`：解压即玩的完整包。
- `release/win-unpacked/`：免安装目录。

> 打包机需要网络下载 NSIS/7zip 工具；大陆网络可用
> `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。
> 本仓库的 `electronDist` 指向本地 `node_modules/electron/dist`，不需要再下载 Electron。

## 曲库与导入

桌面版读取顺序：`MAIMAI_CONTENT_DIR` → 用户曲库（安装版 `Documents/MaimaiKey/content`，便携版 `<exe目录>/content`） → 安装包内置内容。用户内容优先，内置内容兜底。

把压缩包拖进用户曲库，重启游戏即可：

- 已整理好的内容包：zip 内含 `pack.json` + `charts/` + `audio/`；
- 社区 maidata 包：zip 内含 `maidata.txt` + 音频（MP3/WAV/FLAC/M4A/AAC/OGG 等）+ 可选封面。

启动时自动解压/转换并删除 zip，失败原因保存在 `.failed/`。选曲页的「导入曲包」按钮可以直接打开这个文件夹。首次启动还会把占位曲复制为 `content/starter/`，方便查看或替换；删除它后仍会回退到内置版本。

## 音频自动打谱

标题界面按 `C` 或选曲页「自动打谱」打开 CHART LAB：

1. 选择/拖入 MP3、WAV、FLAC、M4A、AAC、OGG、Opus、WebM；
2. 自动检测 BPM（可手动填 BPM 后重新生成）；
3. 调密度、音频偏移，选择是否加入长按/滑条/触摸；
4. 一次生成 Basic / Advanced / Expert / Master 四张谱面；
5. 右侧直接修改 Simai 文本，或导出 `.simai`，然后保存到曲库。

生成的是可玩的草稿：自动分析重音并量化到 16 分音符，质量不等同于人工谱。建议保存后试玩并微调 BPM/偏移。

## 导入社区谱面（CLI）

```bash
pnpm import:maidata <maidata.txt> <audio.ogg|mp3|wav> [--id 包名] [--jacket 封面] [--out public/content]
```

导入后会生成 `pack.json`、`charts/level-N.simai` 与音频副本，并把包名写入 `index.json`。`&first` 会转换成 `audioOffsetMs`。

## 自定义背景

- **主页面**：标题界面按 `B`、点「背景」，或直接把照片拖到窗口；在裁切器里拖动画面、滚轮/滑杆缩放，选择要用的区域后保存。
- **游戏内**：把照片直接拖进游戏窗口，会自动暂停并打开裁切器；也可以在设置里更换游戏背景。
- 设置 → 显示与声音 → 主页面背景 / 游戏背景，可重新选择或恢复默认。
- 支持 JPG、PNG、WebP、AVIF、GIF、BMP、SVG、HEIC/HEIF；HEIC 走内置 WASM 转换。TIFF 等不原生支持的格式请先转成 JPG/PNG/WebP。
- 背景和裁切结果保存在本机 IndexedDB（安装版 `%APPDATA%/maimai-key`，便携版 `<exe目录>/user-data`），重启后仍生效。

## 测试

```bash
pnpm test            # 解析器 / 判定 / 计分 / 设置 / 回放 / 自动打谱
pnpm test:smoke      # 需要先 pnpm dev，截图落在 shots/
pnpm test:e2e        # 需要先 pnpm build && pnpm preview，AUTO 跑到结算
pnpm test:settings   # 键位重绑定 + 持久化
pnpm test:pause      # 暂停/恢复时钟
pnpm test:visuals    # 滑条/触摸渲染（?seek= 定位）
pnpm test:replay     # 游玩 → 保存回放 → 回放
pnpm test:calibration
pnpm test:electron   # 源码方式启动 Electron
pnpm test:content    # 合并用户内容目录
pnpm test:packaged   # 已打包目录冒烟（可用 PACKAGED_EXE 指定安装版）
pnpm test:drop       # zip 拖入自动导入
pnpm test:creator    # 音频自动打谱 + 保存
pnpm test:generated  # 自动打谱 → 编辑 → AUTO 通关
pnpm test:formats    # MP3 / FLAC / M4A 解码 + NCM 拦截
pnpm test:mp3        # MP3 打谱 → 保存 → AUTO 通关
pnpm test:drm        # 加密 zip 的友好失败
pnpm test:background # 背景裁切/持久化/Esc 暂停
pnpm test:hardening  # 坏包容错/弹窗隔离/拖放/全屏
pnpm test:portable   # 便携版数据路径
pnpm test:no-devtools
pnpm test:title-ui   # 主页面左菜单/右侧游戏名/Esc 返回
pnpm test:input-modes # 触屏八区命中/键盘琴键/音符方向
pnpm test:ui         # 截取标题/选曲/设置/三种 HUD
pnpm chart:validate public/content/starter/charts/expert.simai
pnpm check:assets    # 内容完整性与素材类型检查
```

## 调试

- 发布版完全禁用开发者工具（F12、Ctrl+Shift+I/J/C 和默认菜单均不可用）；只有 `pnpm dev:electron` 开发模式保留调试能力。

- `?seek=<毫秒>`：从谱面指定时间开始（调试/练习用），例如 `http://localhost:5173/?seek=23000`。
- `window.__maimaiDebug.stats() / clock()`：浏览器控制台里读取当前判定与音频时钟。
- `pnpm test:visuals` 用它来截取滑条与触摸音符。

> 状态、验收与已知限制见 [docs/roadmap.md](docs/roadmap.md)；内容格式见 [docs/content-format.md](docs/content-format.md)。
