const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { prepareUserContent, saveGeneratedPack, scanPackIds, seedStarter } = require('./content-import.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const allowDevTools = isDev;
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR)
  : null;
let mainWindow = null;

// Test/support override takes precedence; portable builds keep their profile
// next to the exe, installed builds use the normal %APPDATA% location.
const userDataOverride = process.env.MAIMAI_USER_DATA_DIR
  ? path.resolve(process.env.MAIMAI_USER_DATA_DIR)
  : null;
if (userDataOverride || portableDir) {
  try {
    const userData = userDataOverride || path.join(portableDir, 'user-data');
    fs.mkdirSync(userData, { recursive: true });
    app.setPath('userData', userData);
  } catch (error) {
    console.warn('[userData] could not set path', error);
  }
}

function defaultUserContentRoot() {
  return portableDir
    ? path.join(portableDir, 'content')
    : path.join(app.getPath('documents'), 'MaimaiKey', 'content');
}

function userContentRoot() {
  return process.env.MAIMAI_CONTENT_DIR || defaultUserContentRoot();
}

function appEntryUrl() {
  return isDev
    ? process.env.VITE_DEV_SERVER_URL
    : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString();
}

function isTrustedUrl(url) {
  if (!url) return false;
  try {
    const target = new URL(url);
    const entry = new URL(appEntryUrl());
    if (isDev) return target.origin === entry.origin;
    return target.protocol === 'file:' && target.pathname === entry.pathname;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  // Identity is more reliable than comparing file URLs: Windows can report a
  // differently encoded URL for paths containing spaces, #, % or non-ASCII
  // characters. Only the exact main window and its main frame may use IPC.
  if (!mainWindow || event?.sender !== mainWindow.webContents) {
    throw new Error('untrusted IPC sender');
  }
  if (!event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('untrusted IPC sender');
  }
}

function contentRoots() {
  const roots = [];
  if (process.env.MAIMAI_CONTENT_DIR) {
    roots.push(process.env.MAIMAI_CONTENT_DIR);
  }
  // User content lives in Documents (installed) or next to the exe (portable).
  // It intentionally comes before bundled content so a seeded/edited starter pack wins.
  roots.push(userContentRoot());
  if (isDev) {
    roots.push(path.join(__dirname, '..', 'public', 'content'));
  } else {
    roots.push(path.join(app.getAppPath(), 'dist', 'content'));
  }
  return roots;
}

function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, String(relativePath).replace(/^[/\\]+/, ''));
  if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) return null;
  return target;
}

async function readMergedIndex() {
  const packs = [];
  for (const root of contentRoots()) {
    for (const id of scanPackIds(root)) {
      if (!packs.includes(id)) packs.push(id);
    }
  }
  if (packs.length === 0) throw new Error('content index not found in any content root');
  return { kind: 'text', text: JSON.stringify({ schema: 1, packs }) };
}

async function readContent(relativePath) {
  if (relativePath === 'index.json') return readMergedIndex();
  for (const root of contentRoots()) {
    const full = safeJoin(root, relativePath);
    if (!full) continue;
    try {
      const data = await fs.promises.readFile(full);
      if (/\.(json|simai|txt|svg|md)$/i.test(full)) {
        return { kind: 'text', text: data.toString('utf8') };
      }
      return { kind: 'binary', data: new Uint8Array(data) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`content not found: ${relativePath}`);
}

ipcMain.handle('content:read', (event, relativePath) => {
  assertTrustedSender(event);
  return readContent(relativePath);
});
ipcMain.handle('content:user-root', (event) => {
  assertTrustedSender(event);
  return userContentRoot();
});

ipcMain.handle('content:open-folder', async (event) => {
  assertTrustedSender(event);
  const root = userContentRoot();
  fs.mkdirSync(root, { recursive: true });
  const error = await shell.openPath(root);
  return { path: root, error };
});

ipcMain.handle('content:save-generated', (event, payload) => {
  assertTrustedSender(event);
  const root = userContentRoot();
  return saveGeneratedPack(root, payload);
});

ipcMain.on('app:log-error', (event, message) => {
  assertTrustedSender(event);
  try {
    const file = path.join(app.getPath('userData'), 'startup-error.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}]\n${String(message).slice(0, 8000)}\n\n`, 'utf8');
  } catch (error) {
    console.warn('could not write startup error log', error);
  }
});

ipcMain.on('app:quit', (event) => {
  assertTrustedSender(event);
  app.quit();
});

function setFullscreen(value) {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(Boolean(value));
  return mainWindow.isFullScreen();
}

function broadcastFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:fullscreen-changed', mainWindow.isFullScreen());
}

ipcMain.handle('window:toggle-fullscreen', (event) => {
  assertTrustedSender(event);
  if (!mainWindow) return false;
  return setFullscreen(!mainWindow.isFullScreen());
});

ipcMain.handle('window:set-fullscreen', (event, value) => {
  assertTrustedSender(event);
  return setFullscreen(value);
});

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(1000, height),
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#05070d',
    show: false,
    autoHideMenuBar: true,
    title: 'MaimaiKey',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webgl: true,
      devTools: allowDevTools,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('enter-full-screen', broadcastFullscreen);
  mainWindow.on('leave-full-screen', broadcastFullscreen);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      event.preventDefault();
      if (allowDevTools) mainWindow.webContents.toggleDevTools();
    } else if (!allowDevTools && input.control && input.shift) {
      const key = input.key.toLowerCase();
      if (key === 'i' || key === 'j' || key === 'c') event.preventDefault();
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const userRoots = new Set(
      [
        process.env.MAIMAI_CONTENT_DIR,
        userContentRoot(),
      ].filter(Boolean),
    );
    for (const root of userRoots) {
      try {
        prepareUserContent(root);
      } catch (error) {
        console.warn('[content] prepare failed', root, error);
      }
    }
    try {
      const bundled = isDev
        ? path.join(__dirname, '..', 'public', 'content')
        : path.join(app.getAppPath(), 'dist', 'content');
      seedStarter(userContentRoot(), bundled);
    } catch (error) {
      console.warn('[content] seed starter failed', error);
    }
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
