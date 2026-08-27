import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  uriToClashProxy,
  parseSubscriptionContent,
  generateConfig,
  writeConfigYaml,
  b64encode,
  classifyProcess,
  discoverProcesses,
  getAdaptiveProcesses
} from './engine.js';

const REALITY_KEY = "tJqBgNHuFiVusSSfpQ6CnWMVv5q9TRLjXZ6chIe2HlU";

test("TestUriParsing - vmess", () => {
  const payload = JSON.stringify({
    v: "2", ps: "香港-测试", add: "1.2.3.4", port: "443",
    id: "00000000-0000-0000-0000-000000000001", aid: "0",
    scy: "auto", net: "ws", host: "cdn.example.com",
    path: "/ws", tls: "tls", sni: "cdn.example.com",
  });
  const uri = "vmess://" + b64encode(payload);
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "vmess");
  assert.equal(n.server, "1.2.3.4");
  assert.equal(n.port, 443);
  assert.equal(n.network, "ws");
  assert.equal(n.tls, true);
});

test("TestUriParsing - vless_reality", () => {
  const uri = (
    "vless://550e8400-e29b-41d4-a716-446655440000@v.example.com:443" +
    `?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=${REALITY_KEY}` +
    "&sid=abcd&type=tcp&flow=xtls-rprx-vision#VLESS-Reality"
  );
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "vless");
  assert.equal(n.port, 443);
  assert.equal(n.tls, true);
  assert.equal(n.flow, "xtls-rprx-vision");
  assert.equal(n.servername, "www.microsoft.com");
});

test("TestUriParsing - vless_ws", () => {
  const uri = (
    "vless://550e8400-e29b-41d4-a716-446655440000@w.example.com:8443" +
    "?encryption=none&security=tls&sni=w.example.com&type=ws&path=%2Fws&host=w.example.com#VLESS-WS"
  );
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.network, "ws");
  assert.equal(n["ws-opts"].path, "/ws");
});

test("TestUriParsing - trojan", () => {
  const uri = "trojan://pass123@t.example.com:443?security=tls&sni=t.example.com#Trojan";
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "trojan");
  assert.equal(n.password, "pass123");
  assert.equal(n.port, 443);
});

test("TestUriParsing - ss", () => {
  const userinfo = b64encode("aes-256-gcm:pass123");
  const uri = `ss://${userinfo}@s.example.com:8388#SS`;
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "ss");
  assert.equal(n.cipher, "aes-256-gcm");
  assert.equal(n.port, 8388);
});

test("TestUriParsing - ss_with_plugin", () => {
  const userinfo = b64encode("aes-256-gcm:pass123");
  const uri = `ss://${userinfo}@s2.example.com:8389/?plugin=obfs-local%3Bobfs%3Dhttp#SS-Obfs`;
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.server, "s2.example.com");
  assert.equal(n.port, 8389);
  assert.equal(n.plugin, "obfs");
});

test("TestUriParsing - ssr", () => {
  const raw = (
    "sr.example.com:9000:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:pw" +
    `/?obfsparam=${b64encode('tls1.2_ticket_auth_compatible')}` +
    `&protoparam=${b64encode('')}` +
    `&remarks=${b64encode('SSR-测试')}`
  );
  const uri = "ssr://" + b64encode(raw);
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "ssr");
  assert.equal(n.obfs, "tls1.2_ticket_auth");
  assert.equal(n.password, "pw");
  assert.equal(n.name, "SSR-测试");
});

test("TestUriParsing - hysteria2", () => {
  const uri = "hysteria2://hys-pass@h2.example.com:8443?sni=h2.example.com&insecure=1#HY2";
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "hysteria2");
  assert.equal(n.password, "hys-pass");
  assert.equal(n["skip-cert-verify"], true);
});

test("TestUriParsing - hysteria1", () => {
  const uri = "hysteria://h1.example.com:36712?auth=secret&up=50&down=200&obfs=xplus#HY1";
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "hysteria");
  assert.equal(n["auth-str"], "secret");
  assert.equal(n.obfs, "xplus");
});

test("TestUriParsing - tuic", () => {
  const uri = (
    "tuic://00000000-0000-0000-0000-000000000009:tk@tuic.example.com:7788" +
    "?sni=tuic.example.com&congestion_control=bbr&udp_relay_mode=native#TUIC"
  );
  const n = uriToClashProxy(uri);
  assert.ok(n);
  assert.equal(n.type, "tuic");
  assert.equal(n.uuid, "00000000-0000-0000-0000-000000000009");
  assert.equal(n["congestion-controller"], "bbr");
});

test("TestUriParsing - unknown_scheme", () => {
  assert.equal(uriToClashProxy("unknown://whatever"), null);
});

test("TestSubscriptionParsing - base64_subscription", () => {
  const lines = [
    "vmess://" + b64encode('{"ps":"n1","add":"1.1.1.1","port":"443","id":"00000000-0000-0000-0000-000000000001","aid":"0","scy":"auto","net":"tcp","tls":""}'),
    "trojan://pw@t.example.com:443#n2",
  ];
  const text = b64encode(lines.join("\n"));
  const nodes = parseSubscriptionContent(text);
  assert.equal(nodes.length, 2);
});

test("TestSubscriptionParsing - yaml_subscription", () => {
  const text = `
proxies:
  - name: y-1
    type: vmess
    server: 1.2.3.4
    port: 443
    uuid: 00000000-0000-0000-0000-000000000002
    alterId: 0
    cipher: auto
`;
  const nodes = parseSubscriptionContent(text);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, "y-1");
});

test("TestSubscriptionParsing - html_garbage", () => {
  const text = "<!DOCTYPE html><html><body>Forbidden</body></html>";
  const nodes = parseSubscriptionContent(text);
  assert.deepEqual(nodes, []);
});

test("TestGenerateConfig - two_subscriptions", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-"));
  const lines = [
    "trojan://pw@a.example.com:443#A1",
    "ss://" + b64encode("aes-256-gcm:pw") + "@a.example.com:8388#A2",
  ];
  const pathA = path.join(tmp, "a.txt");
  fs.writeFileSync(pathA, b64encode(lines.join("\n")));

  const pathB = path.join(tmp, "b.txt");
  fs.writeFileSync(pathB, `
proxies:
  - name: B1
    type: vmess
    server: 5.6.7.8
    port: 443
    uuid: 00000000-0000-0000-0000-000000000003
    alterId: 0
    cipher: auto
`);

  const subs = [
    { name: "机场A", url: "file://" + pathA },
    { name: "机场B", url: "file://" + pathB },
  ];
  const { config: cfg, warnings } = await generateConfig(subs);
  assert.deepEqual(warnings, []);
  assert.equal(cfg.proxies.length, 3);
  const names = cfg["proxy-groups"].map(g => g.name);
  assert.ok(names.includes("机场A"));
  assert.ok(names.includes("机场B"));
  assert.ok(names.includes("自动选择"));
  assert.ok(names.includes("手动选择"));
  const pnames = cfg.proxies.map(p => p.name);
  assert.ok(pnames.some(x => x.startsWith("机场A|")));
  assert.ok(cfg.rules.includes("MATCH,手动选择"));
  const yamlOutput = writeConfigYaml(cfg);
  assert.ok(yamlOutput.includes("自动选择"));
});

test("TestGenerateConfig - failed_subscription_keeps_others", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-"));
  const pathOk = path.join(tmp, "ok.txt");
  fs.writeFileSync(pathOk, "trojan://pw@ok.example.com:443#OK");

  const subs = [
    { name: "坏的", url: "file:///nonexistent/nope" },
    { name: "好的", url: "file://" + pathOk },
  ];
  const { config: cfg, warnings } = await generateConfig(subs);
  assert.equal(cfg.proxies.length, 1);
  assert.ok(warnings.some(w => w.includes("坏的")));
});

test("TestGenerateConfig - no_subscriptions_fails", async () => {
  await assert.rejects(async () => {
    await generateConfig([]);
  });
});

test("TestGenerateConfig - rule_smart_multi_process", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-smart-"));
  const pathA = path.join(tmp, "a.txt");
  fs.writeFileSync(pathA, "trojan://pw@a.example.com:443#HK-01");
  const pathB = path.join(tmp, "b.txt");
  fs.writeFileSync(pathB, "trojan://pw@b.example.com:443#US-01");

  const subs = [
    { name: "机场A", url: "file://" + pathA },
    { name: "机场B", url: "file://" + pathB },
  ];

  const { config: cfg } = await generateConfig(subs, {
    routingMode: "rule_smart",
    aiPreferredNode: "机场B|US-01",
    customProcesses: [
      { name: "telegram.exe", target: "app" },
      { name: "twitter.com", target: "ai" }
    ]
  });

  const groupNames = cfg["proxy-groups"].map(g => g.name);
  assert.ok(groupNames.includes("AI防封稳定专线"));
  assert.ok(groupNames.includes("常用应用与浏览器"));
  assert.ok(groupNames.includes("自动选择"));

  const aiGroup = cfg["proxy-groups"].find(g => g.name === "AI防封稳定专线");
  assert.equal(aiGroup.proxies[0], "机场B|US-01"); // Preferred stable node is locked first

  assert.ok(cfg.rules.some(r => r.includes("Google Chrome") && r.includes("常用应用与浏览器")));
  assert.ok(cfg.rules.some(r => r.includes("PROCESS-NAME,telegram.exe") && r.includes("常用应用与浏览器")));
  assert.ok(cfg.rules.some(r => r.includes("DOMAIN-SUFFIX,twitter.com") && r.includes("AI防封稳定专线")));
});


test("TestSubscriptionParsing - deep_clash_yaml", () => {
  const padding = "port: 7890\nsocks-port: 7891\nmode: rule\nlog-level: info\n" +
    "dns:\n  enable: true\n  nameserver:\n    - 119.29.29.29\n    - 223.5.5.5\n";
  const yamlContent = padding + `
proxies:
  - name: "HK-01"
    type: vmess
    server: 1.2.3.4
    port: 443
    uuid: 550e8400-e29b-41d4-a716-446655440001
    alterId: 0
    cipher: auto
  - name: "JP-01"
    type: trojan
    server: 5.6.7.8
    port: 443
    password: pass
`;
  const nodes = parseSubscriptionContent(yamlContent);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].name, "HK-01");
  assert.equal(nodes[1].name, "JP-01");
});

test("TestGenerateConfig - multi_urls_in_single_string", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-multi-split-"));
  const pathA = path.join(tmp, "a.txt");
  fs.writeFileSync(pathA, "trojan://pw@a.example.com:443#A1");
  const pathB = path.join(tmp, "b.txt");
  fs.writeFileSync(pathB, "trojan://pw@b.example.com:443#B1");

  const combinedUrl = `file://${pathA}，，file://${pathB}`;
  const { config: cfg } = await generateConfig([{ name: "合并输入", url: combinedUrl }]);

  assert.equal(cfg.proxies.length, 2);
  const groups = cfg["proxy-groups"].map(g => g.name);
  assert.ok(groups.includes("合并输入-1"));
  assert.ok(groups.includes("合并输入-2"));
  assert.ok(groups.includes("自动选择"));
});

test("TestProcessAdaptation - classify_process", () => {
  assert.equal(classifyProcess("launchd"), "DIRECT");
  assert.equal(classifyProcess("windowserver"), "DIRECT");
  assert.equal(classifyProcess("WeChat"), "DIRECT");
  assert.equal(classifyProcess("wechatweb.exe"), "DIRECT");
  assert.equal(classifyProcess("Alipay"), "DIRECT");
  assert.equal(classifyProcess("Bilibili"), "DIRECT");
  assert.equal(classifyProcess("Google Chrome"), "自动选择");
  assert.equal(classifyProcess("chrome.exe"), "自动选择");
  assert.equal(classifyProcess("Cursor"), "自动选择");
  assert.equal(classifyProcess("Claude"), "自动选择");
  assert.equal(classifyProcess("ChatGPT"), "自动选择");
  assert.equal(classifyProcess("node"), "自动选择");
  assert.equal(classifyProcess("unknown_process_xyz"), null);
});

test("TestProcessAdaptation - discover_processes", () => {
  const procs = discoverProcesses(50);
  assert.ok(Array.isArray(procs));
  assert.ok(procs.length > 0);
  assert.ok(typeof procs[0] === 'string');
});

test("TestProcessAdaptation - get_adaptive_processes", () => {
  const result = getAdaptiveProcesses([
    { name: "MyCustomApp.exe", target: "direct" },
    { name: "MyAiAgent", target: "fixed" }
  ]);
  assert.ok(Array.isArray(result));
  assert.ok(result.some(r => r.name === "MyCustomApp.exe" && r.policy === "DIRECT"));
  assert.ok(result.some(r => r.name === "MyAiAgent" && r.policy === "固定节点"));
});

test("TestGenerateConfig - auto_process_rules_injection", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-adaptive-"));
  const pathA = path.join(tmp, "a.txt");
  fs.writeFileSync(pathA, "trojan://pw@a.example.com:443#A1");

  const { config: cfg } = await generateConfig(
    [{ name: "测试机场", url: "file://" + pathA }],
    {
      routingMode: "auto",
      autoProcessRules: true,
      customProcesses: [{ name: "wechat", target: "direct" }]
    }
  );

  const procRules = cfg.rules.filter(r => r.startsWith("PROCESS-NAME,"));
  assert.ok(procRules.length > 0);
  assert.ok(procRules.some(r => r.includes("Google Chrome") || r.includes("Claude") || r.includes("launchd") || r.includes("wechat")));
  assert.ok(cfg.rules.includes("MATCH,手动选择"));
});

test("TestGenerateConfig - expired dynamic token falls back to local node cache", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-cache-"));
  const cacheFile = path.join(tmp, "sub-cache.json");
  const deadUrl = "https://expired.example.com/sub?token=dead1";

  // 预置缓存：该链接上次抓到过 2 个节点
  fs.writeFileSync(cacheFile, JSON.stringify({
    [deadUrl]: {
      cachedAt: Date.now(),
      nodes: [
        { name: "缓存节点1", type: "trojan", server: "c1.example.com", port: 443, password: "pw" },
        { name: "缓存节点2", type: "ss", server: "c2.example.com", port: 8388, cipher: "aes-256-gcm", password: "pw" },
      ],
    },
  }));

  const { config, warnings } = await generateConfig(
    [{ name: "动态机场", url: deadUrl }],
    { routingMode: "auto", autoProcessRules: false, cacheFile }
  );

  assert.ok(config.proxies.length >= 2, "失效链接应使用本地缓存的节点");
  assert.ok(warnings.some(w => w.includes("已使用本地缓存")), "应有缓存兜底提示");
});

test("TestGenerateConfig - successful fetch updates the node cache", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-cache2-"));
  const cacheFile = path.join(tmp, "sub-cache.json");
  const livePath = path.join(tmp, "live.txt");
  fs.writeFileSync(livePath, "trojan://pw@ok.example.com:443#OK");
  const liveUrl = "file://" + livePath;

  await generateConfig(
    [{ name: "机场", url: liveUrl }],
    { routingMode: "auto", autoProcessRules: false, cacheFile }
  );

  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  assert.ok(cache[liveUrl], "抓取成功后应写入缓存");
  assert.ok(Array.isArray(cache[liveUrl].nodes) && cache[liveUrl].nodes.length === 1);
});

test("TestGenerateConfig - placeholder fake nodes are filtered out", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-fake-"));
  const p = path.join(tmp, "sub.txt");
  fs.writeFileSync(p, [
    "trojan://pw@real1.example.com:443#剩余流量：35 GB",
    "trojan://pw@real2.example.com:443#套餐到期：2027-07-19",
    "trojan://pw@real3.example.com:443#官网:https://www.xydizhi.com",
    "trojan://pw@real4.example.com:443#真实节点A",
  ].join("\n"));

  const { config, warnings } = await generateConfig(
    [{ name: "机场", url: "file://" + p }],
    { routingMode: "auto", autoProcessRules: false }
  );
  const names = config.proxies.map(x => x.name);
  assert.ok(names.some(n => n.includes("真实节点A")), "真实节点应保留");
  assert.ok(names.every(n => !/剩余流量|套餐到期|官网:/.test(n)), "占位假节点应被过滤");
  assert.ok(config.proxies.length === 1);
});

test("TestGenerateConfig - API traffic uses auto-switch group, web AI uses fixed node", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-apiai-"));
  const p = path.join(tmp, "sub.txt");
  fs.writeFileSync(p, "trojan://pw@ok.example.com:443#OK");

  const { config } = await generateConfig(
    [{ name: "机场", url: "file://" + p }],
    { routingMode: "auto", autoProcessRules: false }
  );

  const rules = config.rules;
  // API 端点 → API自动切换
  assert.ok(rules.includes("DOMAIN-SUFFIX,cloudcode-pa.googleapis.com,API自动切换"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,api.openai.com,API自动切换"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,daily-cloudcode-pa.googleapis.com,API自动切换"));
  // 网页版 AI → AI防封稳定专线
  assert.ok(rules.includes("DOMAIN-SUFFIX,chatgpt.com,AI防封稳定专线"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,anthropic.com,AI防封稳定专线"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,gemini.google.com,AI防封稳定专线"));
  // API 规则必须在 AI 关键字规则之前（否则 api.openai.com 会被 DOMAIN-KEYWORD,openai 抢走）
  const idxApi = rules.indexOf("DOMAIN-SUFFIX,api.openai.com,API自动切换");
  const idxKw = rules.indexOf("DOMAIN-KEYWORD,openai,AI防封稳定专线");
  assert.ok(idxApi !== -1 && idxKw !== -1 && idxApi < idxKw);
  // cloudcode-pa 不应再进 AI 专线
  assert.ok(!rules.includes("DOMAIN-SUFFIX,cloudcode-pa.googleapis.com,AI防封稳定专线"));
  // 存在 API自动切换 组
  assert.ok(config["proxy-groups"].some(g => g.name === "API自动切换"));
});

test("TestGenerateConfig - domestic app domains always direct (kugou etc.)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-cn-"));
  const p = path.join(tmp, "sub.txt");
  fs.writeFileSync(p, "trojan://pw@ok.example.com:443#OK");

  const { config } = await generateConfig(
    [{ name: "机场", url: "file://" + p }],
    { routingMode: "auto", autoProcessRules: false }
  );
  const rules = config.rules;
  // 酷狗及其 CDN 必须永远直连
  assert.ok(rules.includes("DOMAIN-SUFFIX,kugou.com,DIRECT"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,kgimg.com,DIRECT"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,wswebcdn.com,DIRECT"));
  // 直连规则必须在 MATCH 之前，否则不会命中
  const idxKugou = rules.indexOf("DOMAIN-SUFFIX,kugou.com,DIRECT");
  const idxMatch = rules.indexOf("MATCH,手动选择");
  assert.ok(idxKugou !== -1 && idxKugou < idxMatch);
  // 常用国内 App 抽查
  assert.ok(rules.includes("DOMAIN-SUFFIX,qq.com,DIRECT"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,taobao.com,DIRECT"));
  assert.ok(rules.includes("DOMAIN-SUFFIX,bilibili.com,DIRECT"));
});
