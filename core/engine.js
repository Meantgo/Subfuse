import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import * as yamlModule from 'js-yaml';
const yaml = yamlModule.default || yamlModule;

export const DEFAULT_UA = "clash.meta/v1.19.25";

// -------------------------------- 全机进程自适应分类 --------------------------------

// 系统进程 → 直连规避（避免代理干扰核心系统服务）
export const SYSTEM_PROCESS_KEYWORDS = new Set([
  "launchd", "kernel_task", "windowserver", "loginwindow", "dock", "finder",
  "cfprefsd", "distnoted", "nsurlsessiond", "notifyd", "taskgated", "syspolicyd",
  "opendirectoryd", "hidd", "coreaudiod", "airplayd", "bluetoothd", "sharingd",
  "rapportd", "identityservicesd", "assistantd", "cloudd", "bird", "locationd",
  "mds", "mdworker", "backupd", "timed", "systemstatsd", "softwareupdated",
  "logd", "configd", "airportd", "networkd", "socketfilterfw", "trustd",
  "securityd", "keychainsyncd", "syslogd", "coreservicesd", "universalaccessd",
  "controlcenter", "systemuiserver", "textinputmenuagent", "siri", "corelocationagent",
  "usernotificationcenter", "runningboardd", "symptomsd", "coreduetd", "tccd",
  "useractivityd", "usernoted", "pkd", "nsurlstoraged", "storekitd", "assetsd",
  "familycircled", "transparencyd", "diagnosticd", "spindump", "loginscreen",
  "apple.", "com.apple.",
  // Windows 系统进程
  "system", "svchost", "csrss", "smss", "wininit", "winlogon", "lsass",
  "services", "explorer", "dwm", "spoolsv", "fontdrvhost", "sihost", "ctfmon",
  "taskhostw", "searchindexer", "shellexperiencehost", "runtimebroker",
  "searchhost", "startmenuexperiencehost", "securityhealthservice"
]);

// 国内应用 → 直连规避（微信、网银、视频、购物等，规避代理防止卡顿或被限）
export const DOMESTIC_PROCESS_KEYWORDS = new Set([
  "wechat", "weixin", "wechatweb", "qq", "qqmusic", "tim", "alipay", "taobao",
  "jd", "meituan", "didi", "eleme", "baidu", "baidunetdisk", "bilibili",
  "douyin", "zhihu", "weibo", "xiaomi", "huawei", "oppo", "vivo", "meizu",
  "wps", "kdocs", "dingtalk", "netease", "music", "cloudmusic", "kugou",
  "kwmusic", "youku", "iqiyi", "youdao", "xunlei", "qqnews", "toutiao",
  "ximalaya", "12306", "ctrip", "feizhu", "fliggy", "unionpay",
  "icbc", "ccb", "abc", "cmb", "boc", "cgb", "cib", "spdb", "bob", "ceb",
  "pingan", "bank", "招商银行", "工商银行", "建设银行", "农业银行",
  "lark", "feishu", "wework", "tencent", "sohu", "sina", "163", "126",
  "qqbrowser", "uc", "quark", "夸克"
]);

// 浏览器 / 开发工具 / AI 工具 → 走代理（自动优选最优节点）
export const PROXY_PROCESS_KEYWORDS = new Set([
  "chrome", "safari", "firefox", "edge", "opera", "brave", "arc", "chromium",
  "vivaldi", "yandex", "chrome helper", "code", "code helper", "cursor",
  "claude", "chatgpt", "codex", "gemini", "copilot", "node", "npm", "npx",
  "yarn", "pnpm", "bun", "python", "pip", "ruby", "gem", "go", "cargo",
  "rustc", "git", "ssh", "scp", "sftp", "curl", "wget", "docker",
  "kubectl", "helm", "terraform", "ansible", "mysql", "psql", "redis",
  "postgres", "java", "javac", "kotlin", "swift", "swiftc", "gcc", "clang",
  "make", "cmake", "gradle", "mvn", "flutter", "dart", "pod", "xcodebuild",
  "xcrun", "fastlane", "android", "adb", "emulator", "qemu", "vagrant",
  "minikube", "kind", "k9s", "gh", "jq", "htop", "tmux", "zsh", "bash",
  "fish", "iterm", "terminal", "alacritty", "kitty", "wezterm", "warp",
  "slack", "discord", "teams", "zoom", "skype", "telegram", "whatsapp",
  "signal", "notion", "obsidian", "evernote", "dropbox", "onedrive",
  "figma", "sketch", "photoshop", "illustrator", "blender", "unity",
  "godot", "steam", "epic", "battle.net", "origin", "spotify", "twitch",
  "obs", "vlc", "mpv", "iina", "kodi", "plex", "jellyfin", "aria2",
  "transmission", "qbittorrent", "deluge", "ipfs", "vscode", "intellij",
  "pycharm", "goland", "webstorm", "rider", "androidstudio", "xcode",
  "ghostty", "raycast", "alfred", "utm", "parallels", "vmware"
]);

// 部分机场会注入「剩余流量/套餐到期/官网」等占位假节点，它们不是真实代理，必须过滤
const PLACEHOLDER_NODE_PATTERN = /剩余流量|套餐到期|距离下次重置|^官网:|^星云:|cdn\.xxxlsop3\.com/i;

function isRealNode(n) {
  const nm = String((n && (n.name || n.server)) || '');
  return !PLACEHOLDER_NODE_PATTERN.test(nm);
}

// 国内常用应用域名直连清单：无论合并时这些 App 是否在运行，都永远直连，
// 避免它们的 CDN/边缘节点被解析成非大陆 IP 后误走代理导致卡顿。
const DOMESTIC_DOMAIN_SUFFIXES = [
  // 腾讯系
  "qq.com", "qpic.cn", "gtimg.cn", "myqcloud.com", "qcloud.com",
  // 阿里系
  "taobao.com", "tmall.com", "alipay.com", "alicdn.com",
  // 百度
  "baidu.com", "bdstatic.com", "baidupcs.com",
  // 哔哩哔哩 / 字节
  "bilibili.com", "hdslb.com", "douyin.com", "douyinstatic.com", "bytedance.net",
  // 网易
  "163.com", "netease.com",
  // 视频
  "youku.com", "iqiyi.com", "iqiyipic.com",
  // 音乐
  "kugou.com", "kugou.com.cn", "kgimg.com", "wswebcdn.com", "kuwo.cn", "music.163.com",
  // 其他常用
  "ximalaya.com", "wps.cn", "kingsoft.com", "dingtalk.com",
  "meituan.com", "meituan.net", "jd.com", "360buyimg.com",
  "weibo.com", "sina.com.cn", "sinaimg.cn", "zhihu.com",
  "xiaohongshu.com", "12306.cn", "sm.cn", "unionpay.com", "95516.com",
];

/**
 * 根据进程名自动判断策略：DIRECT（直连规避）/ 自动选择（走代理） / null（未知）
 */
export function classifyProcess(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  for (const k of SYSTEM_PROCESS_KEYWORDS) {
    if (n.includes(k.toLowerCase())) return "DIRECT";
  }
  for (const k of DOMESTIC_PROCESS_KEYWORDS) {
    if (n.includes(k.toLowerCase())) return "DIRECT";
  }
  for (const k of PROXY_PROCESS_KEYWORDS) {
    if (n.includes(k.toLowerCase())) return "自动选择";
  }
  return null;
}

/**
 * 扫描本机正在运行的真实进程名列表（macOS / Linux / Windows 跨平台自适应）
 */
export function discoverProcesses(maxCount = 150) {
  try {
    let out = "";
    if (process.platform === "win32") {
      out = child_process.execSync("tasklist /fo csv /nh", {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      });
      const names = [];
      for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^"([^"]+)"/);
        const pname = match ? match[1] : trimmed.split(',')[0].replace(/"/g, '');
        if (pname && !names.includes(pname)) {
          names.push(pname);
        }
      }
      return names.slice(0, maxCount);
    } else {
      out = child_process.execSync("ps -axo comm=", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const names = [];
      for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const base = path.basename(trimmed);
        if (base && !names.includes(base)) {
          names.push(base);
        }
      }
      return names.slice(0, maxCount);
    }
  } catch (err) {
    console.warn("[SubFuse Engine] discoverProcesses warning:", err.message);
    return [];
  }
}

/**
 * 获取本机真实运行的应用与进程，用于前端展示与自定义覆盖
 */
export function getAdaptiveProcesses(customRules = []) {
  const procs = discoverProcesses(150);
  const result = [];
  const seen = new Set();

  // 1. 用户自定义覆盖项优先展示
  for (const c of customRules || []) {
    if (!c || !c.name) continue;
    const lower = c.name.toLowerCase();
    seen.add(lower);
    result.push({
      name: c.name,
      target: c.target || "auto",
      policy: c.policy || (c.target === "fixed" ? "固定节点" : (c.target === "direct" ? "DIRECT" : "自动规则")),
      category: "custom",
      source: "user",
    });
  }

  // 2. 扫描到的真实应用与进程
  for (const pname of procs) {
    const lower = pname.toLowerCase();
    if (seen.has(lower)) continue;
    if (pname.includes(",")) continue;

    const policy = classifyProcess(pname);
    let category = "unknown";
    if (policy === "DIRECT") {
      let isSys = false;
      for (const k of SYSTEM_PROCESS_KEYWORDS) {
        if (lower.includes(k.toLowerCase())) { isSys = true; break; }
      }
      category = isSys ? "system" : "domestic";
    } else if (policy === "自动选择") {
      category = "proxy";
    }

    if (category === "proxy" || category === "domestic") {
      seen.add(lower);
      let target = "auto";
      if (policy === "DIRECT") {
        target = "direct";
      } else if (lower.includes("claude") || lower.includes("chatgpt") || lower.includes("cursor")) {
        target = "fixed";
      }
      result.push({
        name: pname,
        target,
        policy: policy === "DIRECT" ? "直连" : (target === "fixed" ? "固定节点" : "自动规则"),
        category,
        source: "discovered",
      });
    }
  }

  return result;
}


export function b64decodeSafe(s) {
  if (!s) return "";
  let str = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) {
    str += '=';
  }
  try {
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch {
    return "";
  }
}

export function b64encode(s) {
  return Buffer.from(s, 'utf-8').toString('base64');
}

export function splitHostPort(info) {
  let query = {};
  let hostpart = info;
  if (info.includes("?")) {
    const qIdx = info.indexOf("?");
    const qs = info.slice(qIdx + 1);
    hostpart = info.slice(0, qIdx);
    const params = new URLSearchParams(qs);
    for (const [k, v] of params.entries()) {
      if (!query[k]) query[k] = [];
      query[k].push(v);
    }
  }
  const lastColon = hostpart.lastIndexOf(":");
  let host = hostpart;
  let portStr = "";
  if (lastColon !== -1) {
    host = hostpart.slice(0, lastColon);
    portStr = hostpart.slice(lastColon + 1);
  }
  return { host, portStr, query };
}

export function parseVmss(rest) {
  const raw = b64decodeSafe(rest);
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  const node = {
    name: d.ps || "",
    type: "vmess",
    server: d.add || "",
    port: parseInt(d.port, 10) || 0,
    uuid: d.id || "",
    alterId: parseInt(d.aid, 10) || 0,
    cipher: d.scy || "auto",
    udp: true,
  };
  const net = d.net || "tcp";
  const tls = d.tls || "";
  if (tls) {
    node.tls = true;
    if (d.sni) {
      node.servername = d.sni;
    } else if (d.host) {
      node.servername = d.host;
    }
    if (d.fp) {
      node["client-fingerprint"] = d.fp;
    }
  }
  if (net === "ws") {
    node.network = "ws";
    node["ws-opts"] = {
      path: d.path || "/",
      headers: { Host: d.host || "" },
    };
  } else if (net === "grpc") {
    node.network = "grpc";
    node["grpc-opts"] = {
      "grpc-service-name": d.path || d.serviceName || "",
    };
  } else if (net === "h2") {
    node.network = "h2";
    node["h2-opts"] = {
      path: d.path || "/",
      host: [d.host || ""],
    };
  }
  if (!node.server || !node.port || !node.uuid) {
    return null;
  }
  return node;
}

export function parseVless(rest) {
  let [info, frag] = rest.split("#", 2);
  frag = frag || "";
  const lastAt = info.lastIndexOf("@");
  if (lastAt === -1) return null;
  const uuid = info.slice(0, lastAt);
  const hostpart = info.slice(lastAt + 1);

  const { host, portStr, query } = splitHostPort(hostpart);
  let port = portStr;
  let finalHost = host;
  if (query.port && query.port[0]) {
    port = query.port[0];
  }
  if (query.host && query.host[0]) {
    finalHost = query.host[0];
  }
  if (!/^\d+$/.test(port)) return null;

  const rawFrag = frag.includes("?") ? frag.split("?")[0] : frag;
  const name = rawFrag ? decodeURIComponent(rawFrag) : finalHost;

  const node = {
    name: name || finalHost,
    type: "vless",
    server: finalHost,
    port: parseInt(port, 10),
    uuid,
    udp: true,
  };

  const security = (query.security && query.security[0]) || "none";
  const network = (query.type && query.type[0]) || "tcp";

  if (security === "tls" || security === "reality") {
    node.tls = true;
    if (query.sni && query.sni[0]) {
      node.servername = query.sni[0];
    }
    if (query.fp && query.fp[0]) {
      node["client-fingerprint"] = query.fp[0];
    }
    if (security === "reality") {
      node["reality-opts"] = {};
      if (query.pbk && query.pbk[0]) {
        node["reality-opts"]["public-key"] = query.pbk[0];
      }
      if (query.sid && query.sid[0]) {
        node["reality-opts"]["short-id"] = query.sid[0];
      }
      if (query.spx && query.spx[0]) {
        node["reality-opts"]["spider-x"] = query.spx[0];
      }
    }
  }

  if (query.flow && query.flow[0]) {
    node.flow = query.flow[0];
  }

  if (network === "ws") {
    node.network = "ws";
    const wsPath = (query.path && query.path[0]) || "/";
    const wsHost = (query.host && query.host[0]) || "";
    node["ws-opts"] = {
      path: wsPath,
      headers: { Host: wsHost },
    };
  } else if (network === "grpc") {
    node.network = "grpc";
    node["grpc-opts"] = {
      "grpc-service-name": (query.serviceName && query.serviceName[0]) || "",
    };
  } else if (network === "http") {
    node.network = "http";
    node["http-opts"] = {
      method: "GET",
      path: [(query.path && query.path[0]) || "/"],
      headers: { Host: [(query.host && query.host[0]) || ""] },
    };
  }

  if (!node.server || !node.port || !node.uuid) return null;
  return node;
}

export function parseTrojan(rest) {
  let [info, frag] = rest.split("#", 2);
  frag = frag || "";
  const lastAt = info.lastIndexOf("@");
  if (lastAt === -1) return null;
  const userinfo = info.slice(0, lastAt);
  const hostpart = info.slice(lastAt + 1);

  const { host, portStr, query } = splitHostPort(hostpart);
  if (!/^\d+$/.test(portStr)) return null;

  const rawFrag = frag.includes("?") ? frag.split("?")[0] : frag;
  const name = rawFrag ? decodeURIComponent(rawFrag) : host;

  const node = {
    name: name || host,
    type: "trojan",
    server: host,
    port: parseInt(portStr, 10),
    password: userinfo,
    udp: true,
  };

  if (query.sni && query.sni[0]) {
    node.sni = query.sni[0];
  }
  if (query.allowInsecure && query.allowInsecure[0].toLowerCase() === "true") {
    node["skip-cert-verify"] = true;
  }
  if (query.type && query.type[0] === "ws") {
    node.network = "ws";
    node["ws-opts"] = {
      path: (query.path && query.path[0]) || "/",
      headers: { Host: (query.host && query.host[0]) || "" },
    };
  }
  return node;
}

export function parseSs(rest) {
  let frag = "";
  let workingRest = rest;
  if (workingRest.includes("#")) {
    const parts = workingRest.split("#", 2);
    workingRest = parts[0];
    frag = parts[1];
  }
  let method = "", password = "", host = "", portStr = "", plugin = null;
  if (workingRest.includes("@")) {
    const lastAt = workingRest.lastIndexOf("@");
    const userinfoB64 = workingRest.slice(0, lastAt);
    const hostpart = workingRest.slice(lastAt + 1);
    const methodPass = b64decodeSafe(userinfoB64);
    if (!methodPass.includes(":")) return null;
    const colonIdx = methodPass.indexOf(":");
    method = methodPass.slice(0, colonIdx);
    password = methodPass.slice(colonIdx + 1);

    const hostpartNoq = hostpart.split("?")[0].replace(/\/+$/, "");
    const lastColon = hostpartNoq.lastIndexOf(":");
    if (lastColon === -1) return null;
    host = hostpartNoq.slice(0, lastColon);
    portStr = hostpartNoq.slice(lastColon + 1);

    if (hostpart.includes("?")) {
      plugin = decodeURIComponent(hostpart.slice(hostpart.indexOf("?") + 1));
    }
  } else {
    const decoded = b64decodeSafe(workingRest);
    if (!decoded.includes("@")) return null;
    const lastAt = decoded.lastIndexOf("@");
    const methodPass = decoded.slice(0, lastAt);
    const hostpart = decoded.slice(lastAt + 1);
    if (!methodPass.includes(":")) return null;
    const colonIdx = methodPass.indexOf(":");
    method = methodPass.slice(0, colonIdx);
    password = methodPass.slice(colonIdx + 1);

    const lastColon = hostpart.lastIndexOf(":");
    if (lastColon === -1) return null;
    host = hostpart.slice(0, lastColon);
    portStr = hostpart.slice(lastColon + 1);
  }

  if (!/^\d+$/.test(portStr)) return null;

  const node = {
    name: decodeURIComponent(frag) || host,
    type: "ss",
    server: host,
    port: parseInt(portStr, 10),
    cipher: method,
    password,
    udp: true,
  };

  if (plugin && plugin.includes("obfs")) {
    node.plugin = "obfs";
    node["plugin-opts"] = { mode: "http", host: "www.bing.com" };
  }
  return node;
}

export function parseSsr(rest) {
  const decoded = b64decodeSafe(rest);
  if (!decoded) return null;
  const [main, parampart] = decoded.split("/?", 2);
  const parts = main.split(":");
  if (parts.length < 6) return null;
  const [server, portStr, protocol, method, obfs] = parts;
  if (!/^\d+$/.test(portStr)) return null;
  const password = parts.slice(5).join(":");

  const params = {};
  if (parampart) {
    for (const kv of parampart.split("&")) {
      if (kv.includes("=")) {
        const [k, v] = kv.split("=", 2);
        if (["remarks", "group", "obfsparam", "protoparam"].includes(k)) {
          params[k] = b64decodeSafe(v);
        } else {
          params[k] = v;
        }
      }
    }
  }
  const name = params.remarks || server;
  return {
    name,
    type: "ssr",
    server,
    port: parseInt(portStr, 10),
    cipher: method,
    password,
    protocol,
    "protocol-param": params.protoparam || "",
    obfs,
    "obfs-param": params.obfsparam || "",
    udp: true,
  };
}

export function parseHysteria2(rest) {
  let [info, frag] = rest.split("#", 2);
  frag = frag || "";
  const lastAt = info.lastIndexOf("@");
  if (lastAt === -1) return null;
  const userinfo = info.slice(0, lastAt);
  const hostpart = info.slice(lastAt + 1);

  const { host, portStr, query } = splitHostPort(hostpart);
  if (!/^\d+$/.test(portStr)) return null;

  const node = {
    name: decodeURIComponent(frag) || host,
    type: "hysteria2",
    server: host,
    port: parseInt(portStr, 10),
    password: userinfo,
  };

  if (query.sni && query.sni[0]) {
    node.sni = query.sni[0];
  }
  if (query.insecure && ["1", "true"].includes(query.insecure[0].toLowerCase())) {
    node["skip-cert-verify"] = true;
  }
  if (query.obfs && query.obfs[0]) {
    node.obfs = query.obfs[0];
    node["obfs-password"] = (query["obfs-password"] && query["obfs-password"][0]) || "";
  }
  return node;
}

export function parseHysteria1(rest) {
  let [info, frag] = rest.split("#", 2);
  frag = frag || "";
  const { host, portStr, query } = splitHostPort(info);
  if (!/^\d+$/.test(portStr)) return null;

  const node = {
    name: decodeURIComponent(frag) || host,
    type: "hysteria",
    server: host,
    port: parseInt(portStr, 10),
    up: (query.up && query.up[0]) || "100",
    down: (query.down && query.down[0]) || "100",
    "auth-str": (query.auth && query.auth[0]) || "",
  };
  if (query.obfs && query.obfs[0]) {
    node.obfs = query.obfs[0];
  }
  if (query.insecure && ["1", "true"].includes(query.insecure[0].toLowerCase())) {
    node["skip-cert-verify"] = true;
  }
  return node;
}

export function parseTuic(rest) {
  let [info, frag] = rest.split("#", 2);
  frag = frag || "";
  const lastAt = info.lastIndexOf("@");
  if (lastAt === -1) return null;
  const userinfo = info.slice(0, lastAt);
  const hostpart = info.slice(lastAt + 1);

  const { host, portStr, query } = splitHostPort(hostpart);
  if (!/^\d+$/.test(portStr)) return null;

  let uuid = userinfo;
  let password = (query.password && query.password[0]) || "";
  if (userinfo.includes(":")) {
    const colonIdx = userinfo.indexOf(":");
    uuid = userinfo.slice(0, colonIdx);
    const pw = userinfo.slice(colonIdx + 1);
    if (pw) password = pw;
  }

  const node = {
    name: decodeURIComponent(frag) || host,
    type: "tuic",
    server: host,
    port: parseInt(portStr, 10),
    uuid,
    password,
    "congestion-controller": (query.congestion_control && query.congestion_control[0]) || "bbr",
    "udp-relay-mode": (query.udp_relay_mode && query.udp_relay_mode[0]) || "native",
  };
  if (query.sni && query.sni[0]) {
    node.sni = query.sni[0];
  }
  if (query.allow_insecure && ["1", "true"].includes(query.allow_insecure[0].toLowerCase())) {
    node["skip-cert-verify"] = true;
  }
  return node;
}

export function uriToClashProxy(uri) {
  if (!uri || !uri.includes("://")) return null;
  const colonSlash = uri.indexOf("://");
  const scheme = uri.slice(0, colonSlash).toLowerCase();
  const rest = uri.slice(colonSlash + 3);

  try {
    if (scheme === "vmess") return parseVmss(rest);
    if (scheme === "vless") return parseVless(rest);
    if (scheme === "trojan") return parseTrojan(rest);
    if (scheme === "ss") return parseSs(rest);
    if (scheme === "ssr") return parseSsr(rest);
    if (scheme === "hysteria2" || scheme === "hy2") return parseHysteria2(rest);
    if (scheme === "hysteria") return parseHysteria1(rest);
    if (scheme === "tuic") return parseTuic(rest);
  } catch {
    return null;
  }
  return null;
}

export function parseSubscriptionContent(text) {
  if (!text || typeof text !== "string") return [];

  // 1. Complete YAML Detection (checks anywhere in the file)
  if (text.includes("proxies:")) {
    try {
      const data = yaml.load(text);
      if (data && typeof data === "object" && Array.isArray(data.proxies) && data.proxies.length > 0) {
        return data.proxies;
      }
    } catch (e) {
      console.log("[SubFuse Engine] YAML parse warning:", e.message);
    }
  }

  let decodedText = text;
  const compact = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=_-]+$/.test(compact) && !compact.includes('://')) {
    try {
      const buf = Buffer.from(compact, 'base64');
      const utf8 = buf.toString('utf-8');
      if (utf8 && /^[\x20-\x7E\r\n\t\u4e00-\u9fa5]/.test(utf8)) {
        decodedText = utf8;
      }
    } catch {}
  }

  const nodes = [];
  for (let line of decodedText.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const node = uriToClashProxy(line);
    if (node) nodes.push(node);
  }
  return nodes;
}

export function fetchSubscription(subUrl, proxy = null, timeout = 30000) {
  // 1. Built-in Demo Subscriptions for interactive instant testing
  if (subUrl.includes("demo-sub.airport-a.com") || subUrl.includes("demo1")) {
    return Promise.resolve(`
proxies:
  - name: "香港 01 [IEPL专线 1000M]"
    type: vmess
    server: 104.16.1.1
    port: 443
    uuid: 550e8400-e29b-41d4-a716-446655440001
    alterId: 0
    cipher: auto
    tls: true
    network: ws
  - name: "香港 02 [BGP专线 0.5x]"
    type: trojan
    server: 104.16.1.2
    port: 443
    password: "demo-password-1"
    sni: hk02.demo-airport.com
  - name: "日本 01 [低延迟 游戏首选]"
    type: vless
    server: 104.16.1.3
    port: 443
    uuid: 550e8400-e29b-41d4-a716-446655440003
    tls: true
  - name: "新加坡 01 [原生住宅IP 4K流媒体]"
    type: hysteria2
    server: 104.16.1.4
    port: 8443
    password: "demo-password-2"
`);
  }

  if (subUrl.includes("demo-sub.airport-b.net") || subUrl.includes("demo2")) {
    return Promise.resolve(`
proxies:
  - name: "美国 01 [优质静态IP 专为Claude/ChatGPT优化]"
    type: vmess
    server: 104.16.2.1
    port: 443
    uuid: 550e8400-e29b-41d4-a716-446655440005
    alterId: 0
    cipher: auto
    tls: true
  - name: "美国 02 [原生家宽 稳定防封专用]"
    type: trojan
    server: 104.16.2.2
    port: 443
    password: "demo-password-3"
    sni: us02.demo-airport.com
  - name: "日本 02 [软银直连 大带宽]"
    type: ss
    server: 104.16.2.3
    port: 8388
    cipher: aes-256-gcm
    password: "demo-password-4"
  - name: "英国 01 [伦敦原生IP 极速备份]"
    type: tuic
    server: 104.16.2.4
    port: 7788
    uuid: 550e8400-e29b-41d4-a716-446655440007
    password: "demo-password-5"
`);
  }

  // 2. Handle file://
  if (subUrl.startsWith("file://")) {
    let filePath = subUrl.slice("file://".length);
    if (process.platform === "win32" && filePath.startsWith("/")) {
      filePath = filePath.slice(1);
    }
    try {
      const buf = fs.readFileSync(filePath);
      return Promise.resolve(buf.toString("utf-8"));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // 3. Network Fetch with Auto Proxy Fallback
  return new Promise(async (resolve, reject) => {
    let HttpsProxyAgent = null;
    try {
      const mod = await import("https-proxy-agent");
      HttpsProxyAgent = mod.HttpsProxyAgent;
    } catch {}

    function performFetch(targetUrl, currentProxy, redirectsRemaining = 5) {
      return new Promise((resResolve, resReject) => {
        if (redirectsRemaining <= 0) {
          return resReject(new Error("重定向次数过多"));
        }

        let parsed;
        try {
          parsed = new URL(targetUrl);
        } catch (e) {
          return resReject(new Error(`无效链接: ${targetUrl}`));
        }

        const isHttps = parsed.protocol === "https:";
        const client = isHttps ? https : http;

        const options = {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: "GET",
          headers: {
            "User-Agent": DEFAULT_UA,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
          },
          timeout,
        };

        if (currentProxy && HttpsProxyAgent) {
          try {
            options.agent = new HttpsProxyAgent(currentProxy);
          } catch {}
        }

        const req = client.request(options, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            return performFetch(nextUrl, currentProxy, redirectsRemaining - 1).then(resResolve).catch(resReject);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            return resReject(new Error(`HTTP ${res.statusCode} ${res.statusMessage || ""}`));
          }

          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const enc = (res.headers["content-encoding"] || "").toString().toLowerCase().trim();
            let out = buf;
            if (enc) {
              try {
                if (enc === "gzip") out = zlib.gunzipSync(buf);
                else if (enc === "deflate") out = zlib.inflateSync(buf);
                else if (enc === "br") out = zlib.brotliDecompressSync(buf);
              } catch (decompErr) {
                // 解压失败则保留原始字节交给下游解析，避免误伤不支持该编码的服务器
                out = buf;
              }
            }
            resResolve(out.toString("utf-8"));
          });
        });

        req.on("timeout", () => {
          req.destroy();
          resReject(new Error(`连接超时（超过 ${timeout / 1000} 秒）`));
        });

        req.on("error", (e) => {
          resReject(e);
        });

        req.end();
      });
    }

    try {
      const data = await performFetch(subUrl, proxy);
      resolve(data);
    } catch (firstErr) {
      const errStr = firstErr.message || String(firstErr);
      // Auto-fallback: If proxy was specified and failed with ECONNREFUSED or connection error, retry via direct connection
      if (proxy && (errStr.includes("ECONNREFUSED") || errStr.includes("proxy") || errStr.includes("EHOSTUNREACH"))) {
        console.log(`[SubFuse Engine] 本地代理 (${proxy}) 连接受阻 (${errStr})，自动转为直连拉取...`);
        try {
          const directData = await performFetch(subUrl, null);
          return resolve(directData);
        } catch (directErr) {
          return reject(new Error(`本地代理未响应，转为直连拉取亦受阻: ${directErr.message || directErr}`));
        }
      }
      reject(firstErr);
    }
  });
}

export async function generateConfig(
  subscriptions,
  {
    healthUrl = "http://www.gstatic.com/generate_204",
    interval = 30,
    tolerance = 80,
    fetchProxy = null,
    onProgress = null,
    routingMode = "auto",              // "auto" (自动规则/全机自适应) 或 "global" (全局手动代理)
    globalNode = null,                 // 全局代理模式下锁定的指定节点
    aiPreferredNode = null,            // 自动规则模式下指定的固定防封节点
    customProcesses = [],              // 自定义进程路由 [{ name: 'Claude.exe', target: 'fixed' }]
    autoProcessRules = true,           // 是否自动扫描全机真实进程并自适应生成规则
    defaultProcessPolicy = null,       // 未分类进程默认策略
    cacheFile = null,                  // 订阅节点缓存文件路径（本地持久化，失效时兜底）
  } = {}
) {
  const allProxies = [];
  const perSubGroups = [];
  const warnings = [];

  // 加载订阅节点缓存：即使动态 token 链接失效，也能用上次抓到的节点继续工作
  let nodeCache = {};
  if (cacheFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (parsed && typeof parsed === 'object') nodeCache = parsed;
    } catch {}
  }

  // 智能展开：支持单行粘贴多个由逗号、分号或空格分隔的订阅链接
  const expandedSubscriptions = [];
  for (let i = 0; i < subscriptions.length; i++) {
    const item = subscriptions[i];
    const raw = (item.url || "").trim();
    if (!raw) continue;
    const matched = raw.match(/(?:https?|file):\/\/[^\s，,;]+/gi);
    if (matched && matched.length > 1) {
      matched.forEach((u, subIdx) => {
        expandedSubscriptions.push({
          name: `${item.name || "机场"}-${subIdx + 1}`,
          url: u.trim()
        });
      });
    } else {
      expandedSubscriptions.push(item);
    }
  }

  for (let idx = 0; idx < expandedSubscriptions.length; idx++) {
    const sub = expandedSubscriptions[idx];
    const name = sub.name || `机场${idx + 1}`;
    const rawUrl = (sub.url || "").trim();
    if (!rawUrl) {
      warnings.push(`[${name}] 没有填写链接，已跳过`);
      if (onProgress) onProgress({ type: 'warning', message: `[${name}] 没有填写链接，已跳过` });
      continue;
    }

    if (onProgress) onProgress({ type: 'fetching', name, url: rawUrl });

    let rawNodes = null;
    let fetchErr = null;
    try {
      const text = await fetchSubscription(rawUrl, fetchProxy);
      rawNodes = parseSubscriptionContent(text);
      if (rawNodes && rawNodes.length > 0 && cacheFile) {
        // 抓取成功：更新本地缓存（存原始节点，不掺入机场前缀名）
        nodeCache[rawUrl] = { cachedAt: Date.now(), nodes: rawNodes };
      }
    } catch (e) {
      fetchErr = e;
    }

    let nodes = rawNodes && rawNodes.length > 0 ? rawNodes : null;
    if (!nodes && cacheFile) {
      const cached = nodeCache[rawUrl];
      if (cached && Array.isArray(cached.nodes) && cached.nodes.length > 0) {
        nodes = cached.nodes;
        const reason = fetchErr
          ? (fetchErr.message && fetchErr.message.includes("403") ? "HTTP 403（Token 可能已过期）" : "抓取失败")
          : "本次未解析到节点";
        const msg = `[${name}] ${reason}，已使用本地缓存 ${nodes.length} 个节点（建议到机场后台更新订阅链接）`;
        warnings.push(msg);
        if (onProgress) onProgress({ type: 'warning', message: msg });
      }
    }

    if (!nodes || nodes.length === 0) {
      const errMsg = fetchErr
        ? (fetchErr.message && fetchErr.message.includes("403")
            ? "HTTP 403 Forbidden（机场服务端拒绝访问，可能Token已过期或服务商维护）"
            : (fetchErr.message || String(fetchErr)))
        : "没有解析出任何节点（可能链接失效或格式不支持）";
      const msg = `[${name}] 抓取受阻：${errMsg}`;
      warnings.push(msg);
      if (onProgress) onProgress({ type: 'error', message: msg });
      continue;
    }

    // 过滤占位假节点，保证自动选择 / AI 专线只从真实节点里挑
    nodes = nodes.filter(isRealNode);
    if (nodes.length === 0) {
      const msg = `[${name}] 过滤占位节点后无真实节点可用（可能订阅被服务商注入假节点）`;
      warnings.push(msg);
      if (onProgress) onProgress({ type: 'error', message: msg });
      continue;
    }

    const subNodes = [];
    const seen = new Set();
    for (const n of nodes) {
      let nname = n.name || n.server || "node";
      nname = `${name}|${nname}`;
      if (seen.has(nname)) continue;
      seen.add(nname);
      n.name = nname;
      subNodes.push(n);
    }

    allProxies.push(...subNodes);
    perSubGroups.push({
      name,
      type: "url-test",
      url: healthUrl,
      interval,
      tolerance,
      lazy: false,
      proxies: subNodes.map(n => n.name),
    });

    if (onProgress) {
      onProgress({
        type: 'success',
        name,
        count: subNodes.length,
        message: `[${name}] 成功解析出 ${subNodes.length} 个可用节点`
      });
    }
  }

  if (cacheFile) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(nodeCache), 'utf-8');
    } catch {}
  }

  if (allProxies.length === 0) {
    throw new Error("没有任何可用订阅节点，请检查输入的订阅链接后重试。\n" + warnings.join("\n"));
  }

  // 1. 核心「自动选择」组 (跨机场自动巡检容灾，某机场全挂秒切其他机场)
  const autoGroup = {
    name: "自动选择",
    type: "url-test",
    url: healthUrl,
    interval,
    tolerance,
    lazy: false,
    proxies: perSubGroups.map(g => g.name),
  };

  const allNodeNames = allProxies.map(p => p.name);
  const isGlobalMode = routingMode === "global";

  let proxyGroups = [];
  let rules = [];

  if (isGlobalMode) {
    // ---------------- 全局手动代理模式 ----------------
    const chosenGlobalNode = (globalNode && allNodeNames.includes(globalNode))
      ? globalNode
      : (allNodeNames[0] || "自动选择");

    const manualGroup = {
      name: "手动选择",
      type: "select",
      proxies: [chosenGlobalNode, "自动选择", "DIRECT", ...perSubGroups.map(g => g.name)],
    };

    proxyGroups = [
      ...perSubGroups,
      manualGroup,
      autoGroup,
    ];

    rules = [
      "MATCH,手动选择",
    ];
  } else {
    // ---------------- 自动规则模式 (全机进程自适应 + AI防封稳定) ----------------
    let aiProxiesList = [];
    if (aiPreferredNode && allNodeNames.includes(aiPreferredNode)) {
      aiProxiesList = [aiPreferredNode, ...allNodeNames.filter(n => n !== aiPreferredNode), "自动选择", "DIRECT"];
    } else {
      aiProxiesList = [...allNodeNames.slice(0, 50), "自动选择", "DIRECT"];
    }

    const aiGroup = {
      name: "AI防封稳定专线",
      type: "select",
      proxies: aiProxiesList,
    };

    const browserGroup = {
      name: "常用应用与浏览器",
      type: "select",
      proxies: ["自动选择", ...allNodeNames.slice(0, 60), "DIRECT"],
    };

    // API 流量专用组：Codex / Cloud Code / CPA 等走 API，不会因换 IP 封号，
    // 交给看门狗（检测到 Google 拒绝出口时自动切换节点）自动兜底，不固定节点。
    const apiGroup = {
      name: "API自动切换",
      type: "select",
      proxies: ["自动选择", ...allNodeNames.slice(0, 60), "DIRECT"],
    };

    const manualGroup = {
      name: "手动选择",
      type: "select",
      proxies: ["自动选择", "API自动切换", "AI防封稳定专线", "常用应用与浏览器", "DIRECT", ...perSubGroups.map(g => g.name)],
    };

    proxyGroups = [
      ...perSubGroups,
      manualGroup,
      autoGroup,
      apiGroup,
      aiGroup,
      browserGroup,
    ];

    const processRuleLines = [];
    const covered = new Set();

    // 1. 用户自定义进程与域名路由 (最高优先级)
    if (customProcesses && customProcesses.length > 0) {
      for (const proc of customProcesses) {
        if (!proc || !proc.name) continue;
        const rawName = proc.name.trim();
        if (!rawName || rawName.includes(",")) continue;
        const lower = rawName.toLowerCase();
        covered.add(lower);

        let targetGroup = "自动选择";
        if (proc.target === "ai" || proc.target === "fixed" || proc.action === "AI防封稳定专线") {
          targetGroup = "AI防封稳定专线";
        } else if (proc.target === "app" || proc.target === "chrome" || proc.action === "常用应用与浏览器") {
          targetGroup = "常用应用与浏览器";
        } else if (proc.target === "direct" || proc.action === "DIRECT") {
          targetGroup = "DIRECT";
        } else if (proc.action) {
          targetGroup = proc.action;
        }

        // 域名 vs 进程
        if (rawName.includes(".") && !lower.endsWith(".exe") && !lower.endsWith(".app")) {
          processRuleLines.push(`DOMAIN-SUFFIX,${rawName.replace(/^\*\./, "")},${targetGroup}`);
        } else {
          processRuleLines.push(`PROCESS-NAME,${rawName},${targetGroup}`);
          if (!lower.endsWith(".exe")) {
            processRuleLines.push(`PROCESS-NAME,${rawName}.exe,${targetGroup}`);
            covered.add(`${lower}.exe`);
          }
        }
      }
    }

    // 1.1 内置国内应用域名 → 永远直连（不依赖合并时快照，CDN 边缘 IP 也能兜住）
    for (const d of DOMESTIC_DOMAIN_SUFFIXES) {
      const line = `DOMAIN-SUFFIX,${d},DIRECT`;
      if (!processRuleLines.includes(line)) {
        processRuleLines.push(line);
      }
    }

    // 1.5 API 流量优先走「API自动切换」（必须排在 AI 防封的关键字规则之前，
    //     否则 api.openai.com 会被 DOMAIN-KEYWORD,openai 抢走）
    const builtInApiRules = [
      "DOMAIN-SUFFIX,api.openai.com,API自动切换",
      "DOMAIN-SUFFIX,api.anthropic.com,API自动切换",
      "DOMAIN-SUFFIX,api.claude.ai,API自动切换",
      "DOMAIN-SUFFIX,api.gemini.google.com,API自动切换",
      "DOMAIN-SUFFIX,cloudcode-pa.googleapis.com,API自动切换",
      "DOMAIN-SUFFIX,daily-cloudcode-pa.googleapis.com,API自动切换",
      "DOMAIN-SUFFIX,generativelanguage.googleapis.com,API自动切换",
      "DOMAIN-SUFFIX,oauth2.googleapis.com,API自动切换",
      "DOMAIN-SUFFIX,accounts.google.com,API自动切换",
      "DOMAIN-SUFFIX,accounts.googleusercontent.com,API自动切换",
    ];
    for (const r of builtInApiRules) {
      if (!processRuleLines.includes(r)) {
        processRuleLines.push(r);
      }
    }

    // 2. 内置重点 AI 域名与进程 (防封锁定，仅限网页版 AI 站点)
    const builtInAiRules = [
      "DOMAIN-SUFFIX,anthropic.com,AI防封稳定专线",
      "DOMAIN-SUFFIX,claude.ai,AI防封稳定专线",
      "DOMAIN-KEYWORD,anthropic,AI防封稳定专线",
      "DOMAIN-KEYWORD,claude,AI防封稳定专线",
      "PROCESS-NAME,Claude,AI防封稳定专线",
      "PROCESS-NAME,Claude.exe,AI防封稳定专线",
      "DOMAIN-SUFFIX,openai.com,AI防封稳定专线",
      "DOMAIN-SUFFIX,chatgpt.com,AI防封稳定专线",
      "DOMAIN-SUFFIX,oaistatic.com,AI防封稳定专线",
      "DOMAIN-SUFFIX,oaiusercontent.com,AI防封稳定专线",
      "DOMAIN-KEYWORD,openai,AI防封稳定专线",
      "DOMAIN-SUFFIX,ai.google.dev,AI防封稳定专线",
      "DOMAIN-SUFFIX,gemini.google.com,AI防封稳定专线",
      "PROCESS-NAME,Cursor,AI防封稳定专线",
      "PROCESS-NAME,cursor.exe,AI防封稳定专线",
    ];
    for (const r of builtInAiRules) {
      if (r.startsWith("PROCESS-NAME,")) {
        const pname = r.split(",")[1].toLowerCase();
        if (!covered.has(pname)) {
          processRuleLines.push(r);
          covered.add(pname);
        }
      } else {
        processRuleLines.push(r);
      }
    }

    // 3. 内置浏览器规则
    const browserRules = [
      "PROCESS-NAME,Google Chrome,常用应用与浏览器",
      "PROCESS-NAME,chrome.exe,常用应用与浏览器",
      "PROCESS-NAME,chrome,常用应用与浏览器",
      "PROCESS-NAME,msedge.exe,常用应用与浏览器",
      "PROCESS-NAME,Microsoft Edge,常用应用与浏览器",
      "PROCESS-NAME,Safari,常用应用与浏览器",
    ];
    for (const r of browserRules) {
      const pname = r.split(",")[1].toLowerCase();
      if (!covered.has(pname)) {
        processRuleLines.push(r);
        covered.add(pname);
      }
    }

    // 4. 全机真实进程自适应扫描 (无需用户写死规则，自动识别每个进程该走代理还是直连规避)
    if (autoProcessRules !== false) {
      const discovered = discoverProcesses(150);
      for (const pname of discovered) {
        const lower = pname.toLowerCase();
        if (covered.has(lower) || pname.includes(",")) continue;

        let policy = classifyProcess(pname);
        if (!policy && defaultProcessPolicy) {
          policy = defaultProcessPolicy;
        }

        if (policy) {
          const line = `PROCESS-NAME,${pname},${policy}`;
          if (!processRuleLines.includes(line)) {
            processRuleLines.push(line);
            covered.add(lower);
          }
        }
      }
    }

    rules = [
      ...processRuleLines,
      "GEOIP,private,DIRECT,no-resolve",
      "GEOIP,CN,DIRECT",
      "MATCH,手动选择",
    ];
  }

  const config = {
    mode: isGlobalMode ? "global" : "rule",
    proxies: allProxies,
    "proxy-groups": proxyGroups,
    rules,
  };
  return { config, warnings };
}

export function writeConfigYaml(config) {
  const dateStr = new Date().toLocaleString();
  const header = (
    "# 由 SubFuse 聚合切换器自动生成\n" +
    `# 生成时间：${dateStr}\n` +
    "# 特性架构：\n" +
    "#   - 各机场建立独立低延迟检测组，顶层「自动选择」实现毫秒级无感跨机场断网自愈\n" +
    "#   - 智能全机进程自适应：系统/国内应用直连规避，浏览器/开发工具自动走代理\n" +
    "#   - 针对 Claude / ChatGPT / Cursor 等 AI 服务定向锁定稳定节点，彻底防止频繁跳 IP 导致封号\n\n"
  );
  const baseObj = {
    port: 7897,
    "socks-port": 7898,
    "mixed-port": 7897,
    "allow-lan": false,
    // 关闭 IPv6：避免 IPv4/IPv6 走不同节点导致出口地区不一致，
    // 被 Google 等站点判定为「异常流量」并封禁。
    ipv6: false,
    mode: config.mode || "rule",
    "log-level": "info",
    "external-controller": "127.0.0.1:9097",
    ...config,
  };
  const body = yaml.dump(baseObj, {
    lineWidth: 200,
    noRefs: true,
  });
  return header + body;
}

export async function previewSubscriptions(subscriptions, fetchProxy = null) {
  const results = [];
  const expanded = [];
  for (let i = 0; i < subscriptions.length; i++) {
    const item = subscriptions[i];
    const raw = (item.url || "").trim();
    if (!raw) continue;
    const matched = raw.match(/(?:https?|file):\/\/[^\s，,;\]\[]+/gi);
    if (matched && matched.length > 1) {
      matched.forEach((u, subIdx) => {
        expanded.push({
          name: `${item.name || "机场"}-${subIdx + 1}`,
          url: u.trim()
        });
      });
    } else {
      expanded.push(item);
    }
  }

  for (let idx = 0; idx < expanded.length; idx++) {
    const sub = expanded[idx];
    const name = sub.name || `机场${idx + 1}`;
    const rawUrl = (sub.url || "").trim();
    if (!rawUrl) continue;
    try {
      const text = await fetchSubscription(rawUrl, fetchProxy, 15000);
      const nodes = parseSubscriptionContent(text);
      results.push({
        name,
        count: nodes.length,
        nodes: nodes.map(n => ({
          name: `${name}|${n.name || n.server || "节点"}`,
          rawName: n.name || n.server,
          type: n.type,
          server: n.server,
          port: n.port
        }))
      });
    } catch (err) {
      results.push({
        name,
        error: err.message || String(err),
        count: 0,
        nodes: []
      });
    }
  }
  return results;
}
