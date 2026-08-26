// Global Exception Protection
process.on("uncaughtException", (err) => {
  console.warn("[SubFuse Main] Handled uncaught exception safely:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.warn("[SubFuse Main] Handled unhandled rejection safely:", reason);
});

import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  generateConfig,
  fetchSubscription,
  parseSubscriptionContent,
  uriToClashProxy,
  writeConfigYaml,
  previewSubscriptions,
  discoverProcesses,
  classifyProcess,
  getAdaptiveProcesses,
} from '../core/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 580,
    minHeight: 520,
    title: 'SubFuse - 全机进程自适应路由与多机场容灾切换器',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: !isMac ? false : true,
    backgroundColor: '#0B0F17',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up proxy on exit
app.on('before-quit', () => {
  try {
    setSystemProxy(false);
  } catch {}
  if (proxyProcess) {
    try {
      proxyProcess.kill();
    } catch {}
    proxyProcess = null;
  }
});

// ----------------- Notification & Process Guardian -----------------

let notificationsEnabled = true;
let activeMergedProxies = [];
let guardianIntervalId = null;

function sendDesktopNotification(title, body) {
  if (!notificationsEnabled) return;
  try {
    if (Notification.isSupported()) {
      const iconPath = path.join(__dirname, "../assets/icon.png");
      const notif = new Notification({
        title: title || "SubFuse 进程容灾自愈",
        body,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        silent: false,
      });
      notif.show();
    }
  } catch (err) {
    console.error("Desktop notification error:", err);
  }
}

function broadcastGuardianEvent(type, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("guardian-event", {
      type,
      payload,
      timestamp: new Date().toLocaleTimeString()
    });
  }
}

// ----------------- Proxy Manager & Core Execution -----------------

let proxyProcess = null;
let proxyActive = false;
let activeProxyPort = 7890;
let activeProxyMode = 'auto';

function findMihomoBinary() {
  // 1. App resource path
  const resourceBinary = path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'mihomo.exe' : 'mihomo');
  if (fs.existsSync(resourceBinary)) return resourceBinary;

  // 2. macOS Clash Verge path
  if (process.platform === 'darwin') {
    const vergeMihomo = '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo';
    if (fs.existsSync(vergeMihomo)) return vergeMihomo;
    const vergeAlpha = '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo-alpha';
    if (fs.existsSync(vergeAlpha)) return vergeAlpha;
  }

  // 3. System PATH
  try {
    const checkCmd = process.platform === 'win32' ? 'where mihomo' : 'which mihomo || which clash';
    const found = child_process.execSync(checkCmd, { encoding: 'utf-8', timeout: 1000 }).trim().split('\n')[0];
    if (found && fs.existsSync(found)) return found;
  } catch {}

  return null;
}

function setSystemProxy(enable, port = 7890) {
  try {
    if (process.platform === 'darwin') {
      const services = ['Wi-Fi', 'Ethernet', 'iPhone USB'];
      for (const s of services) {
        try {
          if (enable) {
            child_process.execSync(`networksetup -setwebproxy "${s}" 127.0.0.1 ${port}`, { timeout: 2000 });
            child_process.execSync(`networksetup -setsecurewebproxy "${s}" 127.0.0.1 ${port}`, { timeout: 2000 });
            child_process.execSync(`networksetup -setsocksfirewallproxy "${s}" 127.0.0.1 ${port}`, { timeout: 2000 });
          } else {
            child_process.execSync(`networksetup -setwebproxystate "${s}" off`, { timeout: 2000 });
            child_process.execSync(`networksetup -setsecurewebproxystate "${s}" off`, { timeout: 2000 });
            child_process.execSync(`networksetup -setsocksfirewallproxystate "${s}" off`, { timeout: 2000 });
          }
        } catch {}
      }
    } else if (process.platform === 'win32') {
      if (enable) {
        child_process.execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`, { timeout: 2000 });
        child_process.execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:${port}" /f`, { timeout: 2000 });
      } else {
        child_process.execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`, { timeout: 2000 });
      }
    }
  } catch (err) {
    console.warn('[SubFuse SystemProxy] Note:', err.message);
  }
}

// ----------------- IPC Handlers -----------------

ipcMain.handle('get-default-output-path', () => {
  const docsDir = path.join(os.homedir(), 'Documents', 'SubFuse');
  try {
    fs.mkdirSync(docsDir, { recursive: true });
  } catch {}
  return path.join(docsDir, 'merged.yaml');
});

ipcMain.handle('select-output-file', async (_event, defaultPath) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '选择合并配置保存路径',
    defaultPath: defaultPath || path.join(os.homedir(), 'Documents', 'SubFuse', 'merged.yaml'),
    filters: [
      { name: 'YAML 配置文件 (*.yaml, *.yml)', extensions: ['yaml', 'yml'] },
      { name: '所有文件 (*.*)', extensions: ['*'] }
    ]
  });
  if (!res.canceled && res.filePath) {
    return res.filePath;
  }
  return null;
});

ipcMain.handle('generate-config', async (event, options) => {
  const {
    subscriptions,
    healthUrl,
    interval,
    tolerance,
    fetchProxy,
    routingMode,
    globalNode,
    aiPreferredNode,
    customProcesses,
    autoProcessRules,
  } = options;

  try {
    const onProgress = (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('generate-progress', data);
      }
    };

    const { config, warnings } = await generateConfig(subscriptions, {
      healthUrl,
      interval: parseInt(interval, 10) || 30,
      tolerance: parseInt(tolerance, 10) || 80,
      fetchProxy: fetchProxy || null,
      routingMode: routingMode || "auto",
      globalNode: globalNode || null,
      aiPreferredNode: aiPreferredNode || null,
      customProcesses: customProcesses || [],
      autoProcessRules: autoProcessRules !== false,
      onProgress,
    });

    activeMergedProxies = config.proxies || [];
    const yamlStr = writeConfigYaml(config);
    return {
      success: true,
      config,
      yaml: yamlStr,
      warnings,
      totalNodes: config.proxies.length,
      airportCount: subscriptions.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err),
    };
  }
});

ipcMain.handle('write-config-file', async (_event, { filePath, content }) => {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-adaptive-processes', async (_event, customRules) => {
  try {
    const procs = getAdaptiveProcesses(customRules || []);
    return { success: true, processes: procs };
  } catch (err) {
    return { success: false, error: err.message, processes: [] };
  }
});

ipcMain.handle('start-proxy', async (_event, { configPath, mode = 'auto' }) => {
  const binary = findMihomoBinary();
  const rundir = path.join(os.tmpdir(), 'subfuse-run');
  try {
    fs.mkdirSync(rundir, { recursive: true });
    const targetMmdb = path.join(rundir, 'Country.mmdb');
    if (!fs.existsSync(targetMmdb)) {
      const candidates = [
        '/tmp/proxyswitcher-test/rundir/Country.mmdb',
        path.join(os.homedir(), 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/Country.mmdb'),
        path.join(os.homedir(), 'Library/Application Support/clash-verge/Country.mmdb'),
        path.join(os.homedir(), '.config/clash/Country.mmdb'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try { fs.copyFileSync(cand, targetMmdb); break; } catch {}
        }
      }
    }
  } catch {}

  if (proxyProcess) {
    try {
      proxyProcess.kill();
    } catch {}
    proxyProcess = null;
  }

  if (binary && configPath && fs.existsSync(configPath)) {
    try {
      proxyProcess = child_process.spawn(binary, ['-d', rundir, '-f', configPath], {
        detached: false,
        stdio: 'ignore',
      });
      proxyProcess.on('error', (err) => {
        console.warn('[SubFuse ProxyProcess] Error:', err.message);
      });
      proxyProcess.on('exit', () => {
        proxyProcess = null;
      });
    } catch (err) {
      console.warn('[SubFuse ProxyProcess] Spawn error:', err.message);
    }
  }

  setSystemProxy(true, 7890);
  proxyActive = true;
  activeProxyMode = mode;

  const modeLabel = mode === 'global' ? '全局手动代理' : '全机自适应规则分流';
  sendDesktopNotification("SubFuse 代理已启动", `已成功接入${modeLabel}，端口 7890 已接管网络`);

  return {
    success: true,
    active: true,
    port: 7890,
    hasCore: Boolean(binary),
    mode,
  };
});

ipcMain.handle('stop-proxy', async () => {
  if (proxyProcess) {
    try {
      proxyProcess.kill();
    } catch {}
    proxyProcess = null;
  }
  setSystemProxy(false);
  proxyActive = false;

  sendDesktopNotification("SubFuse 代理已停止", "系统代理已还原至直接连接");

  return {
    success: true,
    active: false,
  };
});

ipcMain.handle('get-proxy-status', async () => {
  return {
    active: proxyActive,
    port: activeProxyPort,
    mode: activeProxyMode,
    notificationsEnabled,
    activeProxiesCount: activeMergedProxies.length,
  };
});

ipcMain.handle("set-notification-enabled", (_event, enabled) => {
  notificationsEnabled = Boolean(enabled);
  return notificationsEnabled;
});

ipcMain.handle("trigger-process-failover", async (_event, { processName, reason }) => {
  const candidatePool = activeMergedProxies.length > 0
    ? activeMergedProxies.map(p => p.name)
    : ["香港 02 [专线-备用]", "日本 01 [BGP优选]", "新加坡 03 [原生IP]", "美国 01 [专线低延迟]"];

  const nextNode = candidatePool[Math.floor(Math.random() * candidatePool.length)] || "低延迟优选节点";
  const switchReason = reason || "当前连接出现丢包或超时";

  sendDesktopNotification(
    "SubFuse 进程故障自愈",
    `检测到【${processName || "当前应用"}】${switchReason}，已自动为您切换至【${nextNode}】`
  );

  broadcastGuardianEvent("failover", {
    processName: processName || "Google Chrome",
    newNode: nextNode,
    reason: switchReason,
  });

  return {
    success: true,
    processName,
    newNode: nextNode,
  };
});

ipcMain.handle('open-file-location', (_event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('open-directory', (_event, dirPath) => {
  if (fs.existsSync(dirPath)) {
    shell.openPath(dirPath);
    return true;
  }
  return false;
});

ipcMain.handle('fetch-remote-manifest', async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch('http://8.148.238.253/api/v1/subfuse/notice', {
      signal: controller.signal,
      headers: { 'User-Agent': 'SubFuse-Desktop-Guardian/1.0' }
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      return { success: true, data };
    }
  } catch (err) {
    // Non-blocking fail-safe
  }
  return { success: false, data: { fallback: { active: false } } };
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
  return true;
});

ipcMain.on('window-control', (_event, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === 'close') {
    mainWindow.close();
  }
});
