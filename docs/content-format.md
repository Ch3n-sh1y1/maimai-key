# 内容格式

## 目录结构

一个内容包是 `content/` 下的一个文件夹（或用户目录中的同名文件夹）：

```
<contentRoot>/
├─ index.json          # 可选；Electron 会自动生成
└─ <packId>/
   ├─ pack.json
   ├─ audio/<track>.mp3|wav|flac|m4a|aac|ogg|opus|webm
   ├─ jacket.<png|jpg|svg>
   └─ charts/<difficulty>.simai
```

浏览器开发模式下从 Vite 的 `public/` 目录读取；Electron 下会合并安装包内 `dist/content`、`%USERPROFILE%/Documents/MaimaiKey/content` 和 `MAIMAI_CONTENT_DIR`。

### 桌面版自动导入（傻瓜模式）

把压缩包直接拖进 `%USERPROFILE%/Documents/MaimaiKey/content`，重启游戏即可：

- 已整理好的内容包：zip 内含 `pack.json` + `charts/` + `audio/`；
- 社区 maidata 包：zip 内含 `maidata.txt` + 音频（MP3/WAV/FLAC/M4A/AAC/OGG/Opus/WebM）+ 可选封面。

游戏启动时会自动解压、转换、写入 `index.json`，成功后删除 zip；失败原因写到 `.failed/`。也可以直接放已解压的包文件夹（含 `pack.json`）。内置占位曲也使用同一套 pack 格式，由 `dist/content` 自动扫描显示。

### 音频自动打谱

标题界面按 `C`（或选曲页「自动打谱」）打开 CHART LAB：

- 选择/拖入 MP3、WAV、FLAC、M4A、AAC、OGG、Opus、WebM；
- 自动检测 BPM，也可手动填写后重新生成；
- 可调密度、音频偏移，以及是否加入长按/滑条/触摸；
- 一次生成 Basic / Advanced / Expert / Master 四张谱面；
- 右侧可直接修改 Simai 后再保存到曲库；
- 也可单独导出 `.simai`。

生成的是“能玩的草稿”，不是人工谱；建议生成后按音乐试玩并手动调整。

### 音频格式与 DRM

可解码：MP3、WAV、FLAC、M4A（AAC）、AAC、OGG、OGA、Opus、WebM。

不解密：网易云 `.ncm`、QQ 音乐 `.qmc*`/`.mflac`/`.mgg`、酷狗 `.kgm`、酷我 `.kwm`、虾米 `.xm` 等平台加密缓存。这些文件受 DRM 保护，工具会检测并提示；请先在平台内合法下载/导出无加密文件。WMA、APE、AIFF 等浏览器不原生支持的格式请先转成 MP3/FLAC。

## pack.json

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | `1` | 格式版本 |
| `id` | string | 必须与目录名一致 |
| `title` / `artist` / `charter` | string | 展示信息 |
| `bpm` | number | 谱面基准 BPM（谱面内 `(bpm)` 可覆盖） |
| `audioOffsetMs` | number | 正值表示音符整体延后于音频 |
| `audio` | string | 相对包目录的音频路径 |
| `jacket` | string? | 封面路径，缺失时显示占位块 |
| `difficulties[]` | array | `{ name, level, chart }`，`chart` 为相对路径 |

## Simai 支持范围

- 头部：`&title`、`&artist`、`&first`、`&wholebpm`、`&lv_N`、`&inote_N`（`maidata.txt`）。
- 拍速与栅格：`(bpm)`、`{n}`（每小节 n 个逗号槽）。
- 音符：`1`..`8`、`1b`、`1x`、`1h[4:1]`、`1h[#1.5]`。
- 滑条：`1-3[4:1]`、`1<3`、`1>3`、`1^3`、`1v3`、`1p3`、`1q3`、`1s3`、`1z3`、`1w3`、`1pp3`、`1qq3`、`1V53`；`*` 分隔多条滑条；`-3[4:1]-5[4:1]` 链式滑条；`[wait##duration]`。
- 触摸：`A1`、`A1h[4:1]`；传感器 A–F。
- 同时音符：`1/2` 或 `12`。
- 终止：`E`。

时间换算：

- 每小节 4 拍；一个逗号槽 = `4 × 60000 / (bpm × grid)` ms。
- `[q:m]` 时长 = `(4 / q) × m` 拍。
- 滑条默认有 1 拍 wait（与 Simai 社区实现一致）；`[#s]` 形式的 wait 为 0。

解析器对未知 token 记录警告并跳过，不中断整张谱面；`pnpm chart:validate` 会打印警告与统计。

## 判定窗口（占位，可配置）

| 预设 | CRITICAL | PERFECT | GREAT | GOOD |
|---|---|---|---|---|
| 键盘友好 | ±32ms | ±64ms | ±110ms | ±160ms |
| 标准 | ±25ms | ±50ms | ±100ms | ±150ms |
| 严格 | ±20ms | ±40ms | ±80ms | ±130ms |

超过 GOOD 视为 MISS。权重：CRITICAL 1.01、PERFECT 1.00、GREAT 0.8、GOOD 0.5、MISS 0；因此全 PERFECT 为 100%，全 CRITICAL 为 101%。这些数值待用社区资料校准后固化。

## 校准

- 音频偏移：音符相对音乐整体提前/延后。
- 输入偏移：键盘事件时间戳的补偿量；总是 FAST 时调大，总是 LATE 时调小。
- 显示偏移：只影响画面，不影响判定。

建议在设置页先用一首熟悉的谱面微调，再固定下来。
