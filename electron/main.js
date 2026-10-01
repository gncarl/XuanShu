import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { startBackend } from './backend/index.js';

// 【重要】把数据目录钉死在 %APPDATA%\ai-gateway，与「应用显示名」解耦。
// app.getPath('userData') 默认 = %APPDATA%\<应用名>，一旦改 productName/名称它就会跟着变，
// 用户已有的频道/模型/令牌会看起来像"凭空消失"。这里显式固定，之后随便改名都不动数据。
// （必须在任何 getPath('userData') 之前调用）
app.setPath('userData', path.join(app.getPath('appData'), 'ai-gateway'));

const isDev = !app.isPackaged;
let mainWindow = null;
let tray = null;
let ports = { proxyPort: 9090, adminPort: 8787 };

// 打包成 GUI 程序后没有控制台，主进程异常只会弹一个对话框、看不到堆栈。
// 这里把致命错误统一写到 userData 下的 main-error.log，方便排查。
// 日志位置：%APPDATA%\ai-gateway\main-error.log
function logFatal(where, err) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'main-error.log'),
      `[${new Date().toISOString()}] ${where}\n${(err && (err.stack || err.message)) || String(err)}\n\n`,
    );
  } catch { /* 落盘失败就放弃，不要因为日志再把主进程弄崩 */ }
}
process.on('uncaughtException', (e) => logFatal('uncaughtException', e));
process.on('unhandledRejection', (e) => logFatal('unhandledRejection', e));

// 自定义红绿灯标题栏：无边框窗口，靠前端绘制控制按钮 + 拖拽区
function createWindow() {
  // 窗口/任务栏图标走运行时设置（无需改写 exe 资源）：
  // 打包后 icon.ico 由 extraResources 放到 resources/ 下，开发时读 assets/。
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#f5f5f7',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      // 注意：必须是 .cjs（CommonJS）。沙箱化渲染进程不加载 ESM 预加载脚本，
      // 用 .js + import 会让 window.app 为 undefined，窗口按钮全部失效。
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${ports.adminPort}/`);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // 最大化/还原时通知渲染层切换按钮图标
  const pushMaxState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:maximize-changed', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', pushMaxState);
  mainWindow.on('unmaximize', pushMaxState);

  mainWindow.on('closed', () => { mainWindow = null; });
}

function setupIpc() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('app:ports', () => ports);

  // 开机启动：打包后注册 exe 本身；开发模式下 Electron 没有独立 exe 可注册，直接返回 false。
  // 附带 --hidden 参数，开机自启时不弹窗口、只进托盘。
  ipcMain.handle('app:setAutoLaunch', (_e, enable) => {
    try {
      if (!app.isPackaged) return { ok: false, error: 'dev' };
      app.setLoginItemSettings({
        openAtLogin: !!enable,
        path: process.execPath,
        args: ['--hidden'],
      });
      return { ok: true, enabled: !!enable };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
  ipcMain.handle('app:getAutoLaunch', () => {
    try {
      if (!app.isPackaged) return { ok: true, enabled: false };
      const s = app.getLoginItemSettings({ args: ['--hidden'] });
      return { ok: true, enabled: !!s.openAtLogin };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

function setupTray() {
  const iconPath = path.join(import.meta.dirname, '..', 'assets', 'tray.png');
  let image;
  if (fs.existsSync(iconPath)) {
    image = nativeImage.createFromPath(iconPath);
  } else {
    // 没有图标文件时用一个 1x1 透明图兜底，避免崩溃
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  const ctx = Menu.buildFromTemplate([
    { label: '打开玄枢', click: () => {
        // 如果窗口不存在，重新创建
        if (!mainWindow) {
          createWindow();
        } else {
          // 恢复并显示窗口
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('玄枢 · 本地 AI 聚合路由网关');
  tray.setContextMenu(ctx);
  tray.on('click', () => {
    if (!mainWindow) {
      createWindow();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 单实例：避免重复启动多个网关
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const dataDir = path.join(app.getPath('userData'), 'ai-gateway-data');
      ports = await startBackend({ isDesktop: true, dataDir });
      setupIpc();
      // 开机自启（--hidden）或手动以 --hidden 启动时不弹窗口，只进托盘
      if (!process.argv.includes('--hidden')) createWindow();
      setupTray();
    } catch (e) {
      logFatal('app.whenReady', e);
      throw e;
    }
  });

  app.on('window-all-closed', (e) => {
    // 桌面端：关窗口但后台网关继续跑（托盘常驻）
    e.preventDefault();
    mainWindow = null;
  });

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
}
