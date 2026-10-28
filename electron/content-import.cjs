/**
 * Drop-in content import for the desktop build.
 *
 * Users can copy chart packs into:
 *   %USERPROFILE%\Documents\MaimaiKey\content
 *
 * Supported inputs:
 *   - a folder containing pack.json (already converted)
 *   - a .zip containing pack.json (ready-made pack)
 *   - a .zip containing maidata.txt + audio + optional jacket (community pack)
 *
 * ZIPs are extracted and converted at startup, then removed. index.json is
 * regenerated so the renderer can keep its simple index-based loader.
 */
const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');

const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.webm'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

const ENCRYPTED_FORMATS = {
  '.ncm': '网易云音乐 NCM 加密缓存',
  '.uc': '网易云音乐缓存',
  '.qmc0': 'QQ 音乐 QMC 加密音频',
  '.qmc2': 'QQ 音乐 QMC 加密音频',
  '.qmc3': 'QQ 音乐 QMC 加密音频',
  '.qmcflac': 'QQ 音乐 QMC 加密音频',
  '.qmcogg': 'QQ 音乐 QMC 加密音频',
  '.mflac': 'QQ 音乐 MFLAC 加密音频',
  '.mflac0': 'QQ 音乐 MFLAC 加密音频',
  '.mgg': 'QQ 音乐 MGG 加密音频',
  '.mgg1': 'QQ 音乐 MGG 加密音频',
  '.kgm': '酷狗 KGM 加密音频',
  '.kgma': '酷狗 KGMA 加密音频',
  '.vpr': '酷狗 VPR 缓存',
  '.kwm': '酷我 KWM 加密音频',
  '.xm': '虾米加密音频',
};
const DIFFICULTY_NAMES = ['Basic', 'Advanced', 'Expert', 'Master', 'Re:Master'];
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;

function safeChild(root, name) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, String(name).replace(/^[/\\]+/, ''));
  if (!target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function walk(dir, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, depth + 1));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function findByName(dir, name) {
  return walk(dir).find((file) => path.basename(file).toLowerCase() === name.toLowerCase()) ?? null;
}


function findEncrypted(dir) {
  return walk(dir).find((file) => ENCRYPTED_FORMATS[path.extname(file).toLowerCase()]) ?? null;
}

function encryptedMessage(file) {
  const label = ENCRYPTED_FORMATS[path.extname(file).toLowerCase()] || '加密音频';
  return (
    `检测到${label}（${path.basename(file)}）。` +
    '这是受 DRM 保护的平台缓存，本项目不解密；请先在平台内合法导出无加密的 MP3/FLAC/M4A 音频。'
  );
}
function findAudio(dir) {
  const candidates = walk(dir).filter((file) => AUDIO_EXTS.includes(path.extname(file).toLowerCase()));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aName = path.basename(a).toLowerCase();
    const bName = path.basename(b).toLowerCase();
    const aScore = /(track|audio|song|main)/.test(aName) ? 1 : 0;
    const bScore = /(track|audio|song|main)/.test(bName) ? 1 : 0;
    if (aScore !== bScore) return bScore - aScore;
    return fs.statSync(b).size - fs.statSync(a).size;
  });
  return candidates[0] ?? null;
}

function findImage(dir) {
  return (
    walk(dir).find((file) => IMAGE_EXTS.includes(path.extname(file).toLowerCase())) ?? null
  );
}

function slugify(value) {
  const ascii = String(value)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, 48);
  if (ascii.length >= 2) return ascii;
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `chart-${hash.toString(36)}`;
}

function uniqueTarget(root, baseId) {
  const base = slugify(baseId);
  let id = base;
  let index = 2;
  while (fs.existsSync(path.join(root, id))) {
    id = `${base}-${index++}`;
  }
  return { id, dir: path.join(root, id) };
}

function extractZip(zipPath, dest) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > 5000) throw new Error('压缩包文件数过多，已停止解压');
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    total += entry.header.size ?? 0;
    if (total > MAX_EXTRACT_BYTES) throw new Error('压缩包过大，已停止解压');
  }
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name || name.includes('__MACOSX/')) continue;
    const target = safeChild(dest, name);
    if (!target) continue;
    if (entry.isDirectory) {
      ensureDir(target);
      continue;
    }
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, entry.getData());
  }
}

function parseMaidata(text) {
  const meta = {};
  let current = null;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = rawLine.match(/^&([A-Za-z0-9_]+)=(.*)$/);
    if (match) {
      current = match[1].toLowerCase();
      meta[current] = match[2];
    } else if (current && rawLine.trim() !== '') {
      meta[current] += `\n${rawLine}`;
    }
  }
  const levels = Object.keys(meta)
    .map((key) => key.match(/^inote_(\d+)$/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  return {
    title: (meta.title || '').trim(),
    artist: (meta.artist || 'Unknown').trim(),
    charter: (meta.charter || meta.designer || 'Unknown').trim(),
    firstSeconds: Number(meta.first) || 0,
    wholeBpm: Number(meta.wholebpm) || 0,
    levels,
    meta,
  };
}

function bpmFromBody(body, fallback) {
  const match = body.match(/\((\d+(?:\.\d+)?)\)/);
  return match ? Number(match[1]) : fallback;
}

function levelValue(text, index) {
  const value = Number.parseFloat(String(text ?? ''));
  return Number.isFinite(value) ? value : index + 1;
}

function importPackDir(srcDir, root) {
  const manifestPath = path.join(srcDir, 'pack.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('pack.json 不是合法 JSON');
  }
  if (!manifest || !Array.isArray(manifest.difficulties) || manifest.difficulties.length === 0) {
    throw new Error('pack.json 缺少 difficulties');
  }
  for (const difficulty of manifest.difficulties) {
    const chartPath = safeChild(srcDir, difficulty?.chart ?? '');
    if (!chartPath || !fs.existsSync(chartPath)) {
      throw new Error(`缺少谱面文件: ${difficulty?.chart ?? '?'}`);
    }
  }
  const audioPath = manifest.audio ? safeChild(srcDir, manifest.audio) : null;
  if (manifest.audio && (!audioPath || !fs.existsSync(audioPath))) {
    throw new Error(`缺少音频文件: ${manifest.audio}`);
  }
  if (manifest.audio) {
    const ext = path.extname(manifest.audio).toLowerCase();
    if (ENCRYPTED_FORMATS[ext]) {
      throw new Error(
        `内容包使用了${ENCRYPTED_FORMATS[ext]}（${ext}）。本项目不解密受 DRM 保护的文件，请改用 MP3/FLAC/M4A。`,
      );
    }
  }

  const desired = manifest.id || path.basename(srcDir) || 'pack';
  const { id, dir } = uniqueTarget(root, desired);
  const staging = fs.mkdtempSync(path.join(root, '.staging-'));
  const staged = path.join(staging, 'pack');
  try {
    fs.cpSync(srcDir, staged, { recursive: true });
    if (manifest.id !== id) {
      manifest.id = id;
      fs.writeFileSync(path.join(staged, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8');
    }
    fs.renameSync(staged, dir);
    return id;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function importMaidataDir(srcDir, root, fallbackName) {
  const maidataPath = findByName(srcDir, 'maidata.txt');
  if (!maidataPath) throw new Error('压缩包里没有 maidata.txt');
  const parsed = parseMaidata(fs.readFileSync(maidataPath, 'utf8'));
  if (parsed.levels.length === 0) throw new Error('maidata.txt 里没有 &inote_N 谱面');
  const audio = findAudio(srcDir);
  if (!audio) {
    const encrypted = findEncrypted(srcDir);
    if (encrypted) throw new Error(encryptedMessage(encrypted));
    throw new Error('压缩包里没有可解码的音频文件（MP3/WAV/FLAC/M4A/AAC/OGG 等）');
  }

  const title = parsed.title || path.basename(fallbackName).replace(/\.zip$/i, '') || 'Untitled';
  const { id, dir } = uniqueTarget(root, parsed.title ? title : fallbackName);
  const staging = fs.mkdtempSync(path.join(root, '.staging-'));
  const stageDir = path.join(staging, 'pack');
  ensureDir(path.join(stageDir, 'charts'));
  ensureDir(path.join(stageDir, 'audio'));

  const audioExt = path.extname(audio).toLowerCase();
  fs.copyFileSync(audio, path.join(stageDir, 'audio', `track${audioExt}`));
  const jacket = findImage(srcDir);
  let jacketName;
  if (jacket) {
    const ext = path.extname(jacket).toLowerCase();
    jacketName = `jacket${ext}`;
    fs.copyFileSync(jacket, path.join(stageDir, jacketName));
  }

  const difficulties = [];
  for (let index = 0; index < parsed.levels.length; index++) {
    const levelIndex = parsed.levels[index];
    const body = parsed.meta[`inote_${levelIndex}`] ?? '';
    const chartName = `charts/level-${levelIndex}.simai`;
    fs.writeFileSync(path.join(stageDir, chartName), body.trim() + '\n', 'utf8');
    difficulties.push({
      name: DIFFICULTY_NAMES[index] ?? `Level ${levelIndex}`,
      level: levelValue(parsed.meta[`lv_${levelIndex}`], index),
      chart: chartName,
    });
  }
  const bpm = parsed.wholeBpm || bpmFromBody(parsed.meta[`inote_${parsed.levels[0]}`] ?? '', 120);
  const manifest = {
    schema: 1,
    id,
    title,
    artist: parsed.artist,
    charter: parsed.charter,
    bpm,
    audioOffsetMs: Math.round(parsed.firstSeconds * 1000),
    audio: `audio/track${audioExt}`,
    ...(jacketName ? { jacket: jacketName } : {}),
    difficulties,
  };
  try {
    fs.writeFileSync(path.join(stageDir, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(stageDir, dir);
    return id;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function importZip(zipPath, root) {
  const work = fs.mkdtempSync(path.join(root, '.import-'));
  try {
    extractZip(zipPath, work);
    const packPath = findByName(work, 'pack.json');
    if (packPath) return importPackDir(path.dirname(packPath), root);
    const maidataPath = findByName(work, 'maidata.txt');
    if (maidataPath) return importMaidataDir(path.dirname(maidataPath), root, path.basename(zipPath));
    const encrypted = findEncrypted(work);
    if (encrypted) throw new Error(encryptedMessage(encrypted));
    throw new Error('压缩包里没有 pack.json 或 maidata.txt');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function scanPackIds(root) {
  const ids = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return ids;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifestPath = path.join(root, entry.name, 'pack.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest && Array.isArray(manifest.difficulties)) ids.push(entry.name);
    } catch {
      // Not a pack folder.
    }
  }
  return ids.sort();
}

function normalizePackFolders(root) {
  for (const folder of scanPackIds(root)) {
    try {
      const manifestPath = path.join(root, folder, 'pack.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!manifest.id || manifest.id === folder) continue;
      const target = path.join(root, manifest.id);
      if (fs.existsSync(target)) continue;
      fs.renameSync(path.join(root, folder), target);
    } catch {
      // Ignore malformed packs; the loader will show a clear error.
    }
  }
}

function writeIndex(root) {
  const packs = scanPackIds(root);
  if (packs.length === 0) return;
  const target = path.join(root, 'index.json');
  const temp = path.join(root, `.index-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify({ schema: 1, packs }, null, 2), 'utf8');
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(target, { force: true });
    fs.renameSync(temp, target);
  }
}

/**
 * Prepares a user content directory before the window is created.
 * Returns the number of newly imported packs.
 */
function prepareUserContent(root) {
  ensureDir(root);
  const readmePath = path.join(root, 'README.txt');
  if (!fs.existsSync(readmePath)) {
    const lines = [
      'MaimaiKey 曲库导入说明',
      '====================',
      '',
      '把谱面包压缩包（.zip）直接拖进这个文件夹，然后重启游戏即可。',
      '',
      '支持两种压缩包：',
      '1. 已经整理好的内容包：zip 内含 pack.json + charts/ + audio/ + 可选 jacket',
      '2. 社区 maidata 包：zip 内含 maidata.txt + 音频（mp3/wav/ogg）+ 可选封面',
      '',
      '启动时游戏会自动解压、转换、写入 index.json，成功后删除 zip。',
      '转换失败时，.failed 文件夹里会留下原因。',
      '',
      '也可以直接放一个已经解压的包文件夹（里面要有 pack.json）。',
      '不要删除内置曲目；用户曲目和内置曲目会自动合并。',
      '',
      '请只使用你有权使用的音乐与谱面。',
    ];
    fs.writeFileSync(readmePath, lines.join('\r\n') + '\r\n', 'utf8');
  }
  const failedDir = path.join(root, '.failed');
  let imported = 0;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.zip')) continue;
    const zipPath = path.join(root, entry.name);
    try {
      const id = importZip(zipPath, root);
      fs.rmSync(zipPath, { force: true });
      imported++;
      console.log(`[content] imported ${entry.name} -> ${id}`);
    } catch (error) {
      ensureDir(failedDir);
      const failed = path.join(failedDir, `${entry.name}.failed.txt`);
      fs.writeFileSync(failed, `${entry.name}\n${error.message}\n`, 'utf8');
      console.warn(`[content] import failed: ${entry.name}: ${error.message}`);
    }
  }
  normalizePackFolders(root);
  writeIndex(root);
  return imported;
}


/**
 * Saves charts generated in the renderer (audio-to-chart tool) as a normal
 * user content pack. Audio bytes travel over IPC; charts are already Simai.
 */
function saveGeneratedPack(root, payload) {
  ensureDir(root);
  const title = String(payload && payload.title ? payload.title : 'Untitled').slice(0, 80).trim() || 'Untitled';
  const { id, dir } = uniqueTarget(root, (payload && payload.id) || title);
  try {
  ensureDir(path.join(dir, 'charts'));
  ensureDir(path.join(dir, 'audio'));

  const audioExt = (path.extname(String((payload && payload.audioName) || 'track.wav')).toLowerCase() || '.wav');
  if (!AUDIO_EXTS.includes(audioExt)) throw new Error(`不支持的音频格式: ${audioExt}`);
  const audioData = Buffer.from((payload && payload.audioData) || []);
  if (audioData.length < 1024) throw new Error('音频数据为空');
  if (audioData.length > 150 * 1024 * 1024) throw new Error('音频文件过大（上限 150MB）');
  fs.writeFileSync(path.join(dir, 'audio', `track${audioExt}`), audioData);

  const sourceCharts = Array.isArray(payload && payload.charts) ? payload.charts : [];
  if (sourceCharts.length === 0) throw new Error('没有可保存的谱面');
  const difficulties = sourceCharts.map((chart, index) => {
    const body = String((chart && chart.body) || '').trim();
    if (body.length < 4) throw new Error(`谱面 ${index + 1} 为空`);
    const chartName = `charts/level-${index + 1}.simai`;
    fs.writeFileSync(path.join(dir, chartName), `${body}\n`, 'utf8');
    return {
      name: String((chart && chart.name) || DIFFICULTY_NAMES[index] || `Level ${index + 1}`),
      level: Number((chart && chart.level) || index + 1),
      chart: chartName,
    };
  });

  const manifest = {
    schema: 1,
    id,
    title,
    artist: String((payload && payload.artist) || 'Unknown').slice(0, 80),
    charter: String((payload && payload.charter) || 'Auto Chart').slice(0, 80),
    bpm: Number((payload && payload.bpm) || 120),
    audioOffsetMs: Math.round(Number((payload && payload.offsetMs) || 0)),
    audio: `audio/track${audioExt}`,
    difficulties,
    generated: true,
  };
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeIndex(root);
  return { id, dir };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Seed the bundled placeholder pack into the writable library once. */
function seedStarter(userRoot, bundledRoot) {
  const marker = path.join(userRoot, '.seeded-starter');
  if (fs.existsSync(marker)) return false;
  const source = path.join(bundledRoot, 'starter');
  if (!fs.existsSync(source)) return false;
  const target = path.join(userRoot, 'starter');
  if (!fs.existsSync(target)) {
    try {
      fs.cpSync(source, target, { recursive: true });
      console.log('[content] seeded bundled starter pack');
    } catch (error) {
      fs.rmSync(target, { recursive: true, force: true });
      throw error;
    }
  }
  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
  writeIndex(userRoot);
  return true;
}
module.exports = {
  prepareUserContent,
  scanPackIds,
  saveGeneratedPack,
  seedStarter,
  writeIndex,
  safeChild,
};
