// SubFuse 配置守护：启动代理前用 mihomo -t 校验配置，
// 若存在 mihomo 无法解析的节点（如非法的 REALITY short-id），
// 自动剔除并重试，避免「一个坏节点导致整个代理无法启动」。

import fs from 'node:fs';
import child_process from 'node:child_process';
import yaml from 'js-yaml';

/**
 * 校验并修复 Clash 配置文件。
 * @param {string} configPath 配置文件路径
 * @param {string} binary mihomo 二进制路径
 * @param {string} rundir 工作目录（需含 Country.mmdb，供 GEOIP 规则使用）
 * @param {number} maxTries 最多剔除节点次数
 * @returns {{ok: boolean, removed: string[], error?: string}}
 */
export function validateAndRepairConfig(configPath, binary, rundir, maxTries = 10) {
  const removed = [];
  if (!binary || !fs.existsSync(binary)) {
    return { ok: false, removed, error: '未找到 mihomo 内核' };
  }
  if (!configPath || !fs.existsSync(configPath)) {
    return { ok: false, removed, error: '配置文件不存在' };
  }

  for (let i = 0; i < maxTries; i++) {
    let out = '';
    try {
      out = child_process.execSync(
        `"${binary}" -t -d "${rundir}" -f "${configPath}"`,
        { encoding: 'utf-8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return { ok: true, removed };
    } catch (err) {
      const msg = String((err && (err.stderr || err.stdout)) || err.message || '');
      const m = msg.match(/proxy\s+(\d+):/i);
      if (!m) {
        return { ok: false, removed, error: msg.trim().split('\n').pop() || '配置校验失败' };
      }
      const idx = parseInt(m[1], 10);
      try {
        const doc = yaml.load(fs.readFileSync(configPath, 'utf-8'));
        const proxies = doc && Array.isArray(doc.proxies) ? doc.proxies : null;
        if (!proxies || idx >= proxies.length || idx < 0) {
          return { ok: false, removed, error: msg.trim().split('\n').pop() };
        }
        const badName = proxies[idx].name || `node-${idx}`;
        proxies.splice(idx, 1);
        for (const g of doc['proxy-groups'] || []) {
          const list = g && g.proxies;
          if (Array.isArray(list)) {
            const j = list.indexOf(badName);
            if (j !== -1) list.splice(j, 1);
          }
        }
        fs.writeFileSync(configPath, yaml.dump(doc, { noRefs: true }), 'utf-8');
        removed.push(badName);
      } catch (e) {
        return { ok: false, removed, error: String((e && e.message) || e) };
      }
    }
  }
  return { ok: false, removed, error: `连续 ${maxTries} 个节点无法解析` };
}
