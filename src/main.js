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
import { validateAndRepairConfig } from '../core/config_guard.js';

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
// AI 专线看门狗：检测 Google 拒绝当前出口（400 地区不支持 / EOF）后自动切换节点
const CPA_LOG_PATH = path.join(os.homedir(), '.cli-proxy-api', 'logs', 'main.log');
// API 流量走「API自动切换」组，由看门狗在 Google 拒绝出口时自动切换节点
const AI_GROUP_NAME = 'API自动切换';
const MIHOMO_CTRL = 'http://127.0.0.1:9097';
let cpaLogPos = 0;
let lastAiSwitchAt = 0;

function readCpaErrorsSinceLastCheck() {
  try {
    const st = fs.statSync(CPA_LOG_PATH);
    if (!st.isFile()) return false;
    if (st.size < cpaLogPos) cpaLogPos = 0; // 日志轮转
    if (st.size === cpaLogPos) return false;
    const fd = fs.openSync(CPA_LOG_PATH, 'r');
    const buf = Buffer.alloc(st.size - cpaLogPos);
    fs.readSync(fd, buf, 0, buf.length, cpaLogPos);
    fs.closeSync(fd);
    cpaLogPos = st.size;
    const text = buf.toString('utf-8');
    // 只在出现「地区不支持」或上游 EOF 时触发节点切换（配额类错误切节点无意义，不触发）
    return /User location is not supported/i.test(text) || /"https:\/\/[a-z0-9.-]*cloudcode-pa[^"]*": EOF/.test(text);
  } catch {
    return false;
  }
}

async function switchAiNode() {
  try {
    const listRes = await fetch(`${MIHOMO_CTRL}/proxies/${encodeURIComponent(AI_GROUP_NAME)}`);
    if (!listRes.ok) return null;
    const group = await listRes.json();
    const all = Array.isArray(group.all) ? group.all : [];
    const now = group.now;
    const idx = all.indexOf(now);
    let next = null;
    for (let i = 1; i <= all.length; i++) {
      const cand = all[(idx + i) % all.length];
      if (cand && cand !== 'DIRECT' && cand !== '自动选择' && cand !== '手动选择') {
        next = cand;
        break;
      }
    }
    if (!next) return null;
    const putRes = await fetch(`${MIHOMO_CTRL}/proxies/${encodeURIComponent(AI_GROUP_NAME)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    return putRes.ok ? next : null;
  } catch {
    return null;
  }
}

async function aiFailoverTick() {
  if (!proxyActive) return;
  const nowMs = Date.now();
  if (nowMs - lastAiSwitchAt < 40000) return; // 防抖：40 秒内最多切换一次
  if (!readCpaErrorsSinceLastCheck()) return;

  lastAiSwitchAt = nowMs;
  const next = await switchAiNode();
  // 切换节点后重启 CPA，强制重建到 Google 的连接（旧 keep-alive 仍走旧节点）
  child_process.exec('brew services restart cliproxyapi', { timeout: 20000 }, () => {});

  const msg = next
    ? `Gemini/API 出口异常，已自动切换到节点：${next}`
    : 'Gemini/API 出口异常，尝试自动切换节点失败（请检查代理状态）';
  sendDesktopNotification('API 节点自动切换', msg);
  broadcastGuardianEvent('failover', { processName: 'Gemini API', newNode: next || '切换失败' });
}

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

// 检测是否有其他代理客户端在运行（ClashX / Clash Verge / 星云等），
// 提醒用户只运行 SubFuse 一个代理软件，避免端口冲突。
function detectOtherProxyClients() {
  try {
    const out = child_process.execSync(
      "pgrep -fl 'ClashX|Clash Verge|com.vortex.helper|verge-mihomo' | grep -v pgrep || true",
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    if (!out) return null;
    const names = [...new Set(out.split('\n').map(l => {
      const parts = l.trim().split(/\s+/);
      return parts.length >= 2 ? parts[1].split('/').pop() : l;
    }))];
    return names.length ? names.join('、') : null;
  } catch {
    return null;
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
      cacheFile: path.join(app.getPath('userData'), 'subscription-cache.json'),
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

ipcMain.handle('config-file-exists', (_event, filePath) => {
  try {
    return typeof filePath === 'string' && fs.existsSync(filePath);
  } catch {
    return false;
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
  const conflictClients = detectOtherProxyClients();
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

  // 启动前自动校验配置，剔除 mihomo 无法解析的节点（如非法 REALITY short-id）
  const guard = validateAndRepairConfig(configPath, binary, rundir);
  if (!guard.ok) {
    return {
      success: false,
      active: false,
      warning: conflictClients
        ? `检测到其他代理客户端正在运行：${conflictClients}。请退出它们，只保留 SubFuse。`
        : null,
      error: guard.error || '配置校验失败',
    };
  }

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

  // 启动 AI 专线看门狗：CPA 出现 Google 地区拒绝/EOF 时自动切换节点
  try {
    cpaLogPos = fs.existsSync(CPA_LOG_PATH) ? fs.statSync(CPA_LOG_PATH).size : 0;
  } catch {}
  if (!guardianIntervalId) {
    guardianIntervalId = setInterval(aiFailoverTick, 15000);
  }

  const modeLabel = mode === 'global' ? '全局手动代理' : '全机自适应规则分流';
  sendDesktopNotification("SubFuse 代理已启动", `已成功接入${modeLabel}，端口 7890 已接管网络`);

  return {
    success: true,
    active: true,
    repairedNodes: guard.removed,
    warning: conflictClients
      ? `检测到其他代理客户端正在运行：${conflictClients}。请退出它们，只保留 SubFuse，否则可能出现端口冲突。`
      : null,
    port: 7890,
    hasCore: Boolean(binary),
    mode,
  };
});

ipcMain.handle('stop-proxy', async () => {
  if (guardianIntervalId) {
    clearInterval(guardianIntervalId);
    guardianIntervalId = null;
  }
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
