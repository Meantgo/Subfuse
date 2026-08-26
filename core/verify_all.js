import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as yamlModule from 'js-yaml';
const yaml = yamlModule.default || yamlModule;

import {
  generateConfig,
  writeConfigYaml,
  uriToClashProxy,
  parseSubscriptionContent,
  b64encode
} from './engine.js';

console.log("1. Testing 8 proxy protocols parsing...");
const protocols = [
  {
    type: 'vmess',
    uri: 'vmess://' + b64encode(JSON.stringify({
      v: "2", ps: "VMess-Node", add: "vm.node.com", port: 443,
      id: "11111111-2222-3333-4444-555555555555", aid: 0,
      scy: "auto", net: "ws", host: "vm.node.com", path: "/vm", tls: "tls"
    })),
    check: (n) => n.type === 'vmess' && n.server === 'vm.node.com' && n.network === 'ws'
  },
  {
    type: 'vless-reality',
    uri: 'vless://uuid@vl.node.com:443?encryption=none&security=reality&sni=www.apple.com&fp=chrome&pbk=tJqBgNHuFiVusSSfpQ6CnWMVv5q9TRLjXZ6chIe2HlU&sid=abcd&type=tcp&flow=xtls-rprx-vision#VLESS-Node',
    check: (n) => n.type === 'vless' && n.tls === true && n['reality-opts']['public-key']
  },
  {
    type: 'trojan',
    uri: 'trojan://trojanpass@tr.node.com:443?security=tls&sni=tr.node.com#Trojan-Node',
    check: (n) => n.type === 'trojan' && n.password === 'trojanpass'
  },
  {
    type: 'ss',
    uri: `ss://${b64encode('aes-256-gcm:sspass')}@ss.node.com:8388#SS-Node`,
    check: (n) => n.type === 'ss' && n.cipher === 'aes-256-gcm'
  },
  {
    type: 'ssr',
    uri: 'ssr://' + b64encode(`ssr.node.com:9000:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:ssrpass/?obfsparam=&protoparam=&remarks=${b64encode('SSR-Node')}`),
    check: (n) => n.type === 'ssr' && n.password === 'ssrpass'
  },
  {
    type: 'hysteria2',
    uri: 'hysteria2://hy2pass@hy2.node.com:8443?sni=hy2.node.com&insecure=1#HY2-Node',
    check: (n) => n.type === 'hysteria2' && n.password === 'hy2pass' && n['skip-cert-verify'] === true
  },
  {
    type: 'hysteria1',
    uri: 'hysteria://hy1.node.com:36712?auth=hy1pass&up=100&down=500#HY1-Node',
    check: (n) => n.type === 'hysteria' && n['auth-str'] === 'hy1pass'
  },
  {
    type: 'tuic',
    uri: 'tuic://tuicuser:tuicpass@tuic.node.com:7788?sni=tuic.node.com&congestion_control=bbr#TUIC-Node',
    check: (n) => n.type === 'tuic' && n.password === 'tuicpass'
  }
];

for (const p of protocols) {
  const node = uriToClashProxy(p.uri);
  assert.ok(node, `Failed to parse ${p.type}`);
  assert.ok(p.check(node), `Validation failed for ${p.type}`);
  console.log(`  ✓ ${p.type} parsed successfully: ${node.name || node.server} (${node.type})`);
}

console.log("\n2. Testing multi-subscription merge and YAML validation...");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "subfuse-verify-"));
const pathA = path.join(tmp, "sub_a.txt");
const pathB = path.join(tmp, "sub_b.yaml");

fs.writeFileSync(pathA, b64encode(protocols.slice(0, 4).map(p => p.uri).join('\n')));
fs.writeFileSync(pathB, `
proxies:
  - name: B-Node-1
    type: trojan
    server: b1.example.com
    port: 443
    password: pass
  - name: B-Node-2
    type: hysteria2
    server: b2.example.com
    port: 8443
    password: pass
`);

const { config, warnings } = await generateConfig([
  { name: "唯云专线", url: "file://" + pathA },
  { name: "星流中继", url: "file://" + pathB },
]);

assert.equal(config.proxies.length, 6);
assert.equal(warnings.length, 0);
console.log(`  ✓ Generated ${config.proxies.length} proxies across 2 airports`);

const yamlStr = writeConfigYaml(config);
assert.ok(yamlStr.startsWith("# 由 SubFuse"));
assert.ok(yamlStr.includes("自动选择"));
assert.ok(yamlStr.includes("手动选择"));
assert.ok(yamlStr.includes("唯云专线"));
assert.ok(yamlStr.includes("星流中继"));

// Verify that the generated YAML can be loaded without error by YAML parser
const loaded = yaml.load(yamlStr);
assert.equal(loaded.mode, "rule");
assert.equal(loaded.proxies.length, 6);
assert.equal(loaded["proxy-groups"].length, 4); // 2 airports + 手动选择 + 自动选择
console.log(`  ✓ YAML output passed syntax and schema validation`);

console.log("\n✓ All End-to-End Verifications PASSED!");
