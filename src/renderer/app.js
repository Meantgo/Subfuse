// SubFuse - Professional Desktop Proxy Hub Controller

let subItems = [];
let generatedYaml = '';
let currentOutputPath = '';
let parsedNodesCache = [];
let currentMode = 'auto'; // 'auto' (自动规则) or 'global' (全局手动代理)
let isConnected = false;
let userCustomProcesses = [];
let allAdaptiveProcesses = [];

// ----------------- 本地持久化（同一次安装内记住用户输入） -----------------
const SUB_STORAGE_KEY = 'subfuse-subscriptions-v1';
const MODE_STORAGE_KEY = 'subfuse-mode-v1';

function saveSubscriptions() {
  try {
    const list = subItems
      .map(i => ({ name: i.name, url: i.input.value.trim() }))
      .filter(i => i.url);
    localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function loadSubscriptions() {
  try {
    const raw = localStorage.getItem(SUB_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(i => i && i.url) : [];
  } catch {
    return [];
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

// ----------------- Subscription Items Management -----------------

function addSubItem(name = '', url = '') {
  const container = document.getElementById('sub-container');
  const index = subItems.length + 1;
  const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const div = document.createElement('div');
  div.className = 'sub-item';
  div.id = id;

  const defaultName = name || `机场 ${index}`;

  div.innerHTML = `
    <span class="sub-tag">${defaultName}</span>
    <input type="text" class="sub-input" placeholder="粘贴订阅链接 (支持多个链接用 ，， 或换行隔开)" value="${url}">
    <span class="sub-status" id="${id}-status">就绪</span>
    <button class="btn-remove" title="删除">✕</button>
  `;

  container.appendChild(div);

  const input = div.querySelector('.sub-input');
  const status = div.querySelector('.sub-status');
  const btnRemove = div.querySelector('.btn-remove');

  // 编辑即保存，保证重启后订阅链接还在
  input.addEventListener('input', saveSubscriptions);

  // Smart multi-URL split on paste (handles Chinese commas ，，, English commas, brackets, spaces)
  input.addEventListener('paste', () => {
    setTimeout(() => {
      const val = input.value.trim();
      const matched = val.match(/(?:https?|file):\/\/[^\s，,;\]\[]+/gi);
      if (matched && matched.length > 1) {
        input.value = matched[0];
        for (let i = 1; i < matched.length; i++) {
          addSubItem(`机场 ${subItems.length + 1}`, matched[i]);
        }
        showToast(`已自动识别并拆分为 ${matched.length} 个独立机场`);
      }
    }, 60);
  });

  btnRemove.addEventListener('click', () => {
    if (subItems.length <= 1) {
      showToast('至少保留一个订阅行');
      return;
    }
    div.remove();
    subItems = subItems.filter(i => i.id !== id);
    reindexItems();
    saveSubscriptions();
  });

  const itemObj = { id, element: div, input, status, name: defaultName };
  subItems.push(itemObj);
  saveSubscriptions();
  return itemObj;
}

function reindexItems() {
  subItems.forEach((item, idx) => {
    item.name = `机场 ${idx + 1}`;
    item.element.querySelector('.sub-tag').textContent = item.name;
  });
}

async function handlePasteAll() {
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip || !clip.trim()) {
      showToast('剪贴板中暂无内容');
      return;
    }
    const urls = clip.match(/(?:https?|file):\/\/[^\s，,;\]\[]+/gi);
    if (!urls || urls.length === 0) {
      showToast('未在剪贴板中识别到有效订阅链接');
      return;
    }

    document.getElementById('sub-container').innerHTML = '';
    subItems = [];
    urls.forEach((u, idx) => {
      addSubItem(`机场 ${idx + 1}`, u.trim());
    });
    showToast(`已从剪贴板添加 ${urls.length} 个机场订阅链接`);
  } catch (err) {
    showToast(`无法读取剪贴板: ${err.message}`);
  }
}

function handleLoadDemo() {
  document.getElementById('sub-container').innerHTML = '';
  subItems = [];
  addSubItem('机场 1', 'https://demo-sub.airport-a.com/api/v1/client/subscribe?token=demo1');
  addSubItem('机场 2', 'https://demo-sub.airport-b.net/v2ray/sub?key=demo2');
  showToast('已填入 2 个演示订阅链接');
}

// ----------------- Dropdowns & Node Management -----------------

function updateNodeDropdowns(proxies) {
  const globalSelect = document.getElementById('select-global-node');
  const aiSelect = document.getElementById('select-ai-node');

  const curGlobal = globalSelect.value;
  const curAi = aiSelect.value;

  globalSelect.innerHTML = '<option value="">自动优选最低延迟节点</option>';
  aiSelect.innerHTML = '<option value="">自动优选稳定专线节点</option>';

  if (proxies && proxies.length > 0) {
    proxies.forEach(p => {
      const opt1 = document.createElement('option');
      opt1.value = p.name;
      opt1.textContent = p.name;
      globalSelect.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = p.name;
      opt2.textContent = p.name;
      aiSelect.appendChild(opt2);
    });

    if (curGlobal) globalSelect.value = curGlobal;
    if (curAi) aiSelect.value = curAi;
  }
}

// ----------------- Mode Switcher -----------------

function switchMode(mode) {
  currentMode = mode;
  try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch {}
  const tabAuto = document.getElementById('tab-auto');
  const tabGlobal = document.getElementById('tab-global');
  const panelAuto = document.getElementById('panel-auto-rules');
  const panelGlobal = document.getElementById('panel-global-select');

  if (mode === 'auto') {
    tabAuto.classList.add('active');
    tabGlobal.classList.remove('active');
    panelAuto.style.display = 'flex';
    panelGlobal.style.display = 'none';
  } else {
    tabGlobal.classList.add('active');
    tabAuto.classList.remove('active');
    panelAuto.style.display = 'none';
    panelGlobal.style.display = 'flex';
  }

  if (isConnected) {
    const statusText = document.getElementById('conn-status-text');
    const modeLabel = mode === 'auto' ? '自动规则模式' : '全局手动代理';
    statusText.textContent = `已连接 · ${modeLabel} (端口 7890)`;
  }
}

// ----------------- Adaptive Processes Scanning & Rendering -----------------

async function loadAdaptiveProcesses() {
  const badge = document.getElementById('proc-count-badge');
  badge.textContent = '正在扫描本机真实进程...';

  try {
    const res = await window.subfuse.getAdaptiveProcesses(userCustomProcesses);
    if (!res || !res.success || !res.processes) {
      badge.textContent = '暂未识别到运行进程';
      return;
    }

    allAdaptiveProcesses = res.processes;
    badge.textContent = `已自适应识别 ${allAdaptiveProcesses.length} 个真实进程`;
    renderProcessList();
  } catch (err) {
    badge.textContent = '进程扫描异常';
    console.error('Failed to discover processes:', err);
  }
}

function renderProcessList() {
  const listContainer = document.getElementById('process-list');
  listContainer.innerHTML = '';

  if (allAdaptiveProcesses.length === 0) {
    listContainer.innerHTML = '<div style="color: var(--text-3); font-size: 11px; padding: 6px;">暂未识别到受控进程</div>';
    return;
  }

  allAdaptiveProcesses.forEach(proc => {
    const item = document.createElement('div');
    item.className = 'process-item';
    item.setAttribute('data-name', proc.name);

    let dotClass = 'proxy';
    let tagClass = 'proxy';
    let tagLabel = '代理';

    if (proc.target === 'direct' || proc.policy === 'DIRECT' || proc.category === 'domestic' || proc.category === 'system') {
      dotClass = 'direct';
      tagClass = 'direct';
      tagLabel = '直连';
    } else if (proc.target === 'fixed' || proc.policy.includes('固定') || proc.category === 'ai') {
      dotClass = 'ai';
      tagClass = 'ai';
      tagLabel = 'AI锁定';
    }

    item.innerHTML = `
      <div class="proc-item-left">
        <span class="proc-dot ${dotClass}"></span>
        <span class="proc-item-name" title="${proc.name}">${proc.name}</span>
        <span class="proc-tag ${tagClass}">${tagLabel}</span>
      </div>
      <div class="proc-item-right" style="display: flex; align-items: center; gap: 6px;">
        <select class="proc-select" data-pname="${proc.name}">
          <option value="auto" ${proc.target === 'auto' ? 'selected' : ''}>自动规则</option>
          <option value="fixed" ${proc.target === 'fixed' ? 'selected' : ''}>固定节点</option>
          <option value="direct" ${proc.target === 'direct' ? 'selected' : ''}>直连规避</option>
        </select>
        ${proc.source === 'user' ? `<button class="btn-remove-proc" data-pname="${proc.name}" title="删除自定义项">✕</button>` : ''}
      </div>
    `;

    listContainer.appendChild(item);

    const select = item.querySelector('.proc-select');
    select.addEventListener('change', () => {
      proc.target = select.value;
      const existing = userCustomProcesses.find(c => c.name.toLowerCase() === proc.name.toLowerCase());
      if (existing) {
        existing.target = select.value;
      } else {
        userCustomProcesses.push({ name: proc.name, target: select.value });
      }
      renderProcessList();
      showToast(`已更新【${proc.name}】策略为: ${select.options[select.selectedIndex].text}`);
    });

    const removeBtn = item.querySelector('.btn-remove-proc');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        userCustomProcesses = userCustomProcesses.filter(c => c.name.toLowerCase() !== proc.name.toLowerCase());
        allAdaptiveProcesses = allAdaptiveProcesses.filter(p => p.name.toLowerCase() !== proc.name.toLowerCase());
        renderProcessList();
        showToast(`已移除自定义进程: ${proc.name}`);
      });
    }
  });
}

function handleAddCustomProc() {
  const name = prompt('请输入要绑定的进程名或域名后缀（如 spotify.exe, twitter.com）：');
  if (!name || !name.trim()) return;

  const cleanName = name.trim();
  const existing = allAdaptiveProcesses.find(p => p.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    showToast(`进程【${cleanName}】已在列表中`);
    return;
  }

  const newProc = {
    name: cleanName,
    target: 'auto',
    policy: '自动选择',
    category: 'custom',
    source: 'user',
  };

  userCustomProcesses.push(newProc);
  allAdaptiveProcesses.unshift(newProc);
  renderProcessList();
  showToast(`已添加自定义进程【${cleanName}】`);
}

function collectProcessesForConfig() {
  return allAdaptiveProcesses.map(p => ({
    name: p.name,
    target: p.target,
    policy: p.target === 'direct' ? 'DIRECT' : (p.target === 'fixed' ? 'AI防封稳定专线' : '自动选择'),
  }));
}

// ----------------- Merge Configuration Action -----------------

async function handleMergeConfig() {
  const btn = document.getElementById('btn-submit');
  const badge = document.getElementById('merge-status-badge');

  const subs = [];
  subItems.forEach(item => {
    const u = item.input.value.trim();
    if (u) {
      subs.push({ name: item.name, url: u });
    }
  });

  if (subs.length === 0) {
    badge.className = 'status-badge error';
    badge.textContent = '请填入订阅';
    showToast('请至少填入一个可用的机场订阅链接');
    return;
  }

  btn.classList.add('loading');
  btn.querySelector('.btn-text').textContent = '正在抓取合并...';
  badge.className = 'status-badge ready';
  badge.textContent = '合并中...';

  subItems.forEach(i => {
    i.status.textContent = '请求中...';
    i.status.className = 'sub-status';
  });

  const globalNode = document.getElementById('select-global-node').value || null;
  const aiPreferredNode = document.getElementById('select-ai-node').value || null;
  const customProcesses = collectProcessesForConfig();

  try {
    const res = await window.subfuse.generateConfig({
      subscriptions: subs,
      interval: 30,
      tolerance: 80,
      routingMode: currentMode,
      globalNode,
      aiPreferredNode,
      customProcesses,
      autoProcessRules: true,
    });

    if (!res.success) {
      badge.className = 'status-badge error';
      badge.textContent = '合并受阻';
      showToast(`合并受阻: ${res.error}`);
      return;
    }

    generatedYaml = res.yaml;
    parsedNodesCache = res.config.proxies || [];
    updateNodeDropdowns(parsedNodesCache);

    await window.subfuse.writeConfigFile({
      filePath: currentOutputPath,
      content: res.yaml,
    });

    if (res.warnings && res.warnings.length > 0 && res.totalNodes > 0) {
      badge.className = 'status-badge warning';
      badge.textContent = `已合并 ${res.totalNodes} 个节点 (部分跳过)`;
      showToast(`成功合并 ${res.totalNodes} 个节点（部分失效链接已自动跳过）`);
    } else {
      badge.className = 'status-badge success';
      badge.textContent = `已合并 ${res.totalNodes} 个节点`;
      showToast(`成功合并 ${res.totalNodes} 个可用节点`);
    }
  } catch (err) {
    badge.className = 'status-badge error';
    badge.textContent = '异常中断';
    showToast(`异常: ${err.message}`);
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('.btn-text').textContent = '合并配置';
  }
}

// ----------------- Connect / Proxy Launch Action -----------------

async function handleToggleConnect() {
  const btn = document.getElementById('btn-toggle-connect');
  const btnText = document.getElementById('btn-connect-text');
  const dot = document.getElementById('conn-dot');
  const statusText = document.getElementById('conn-status-text');

  if (isConnected) {
    await window.subfuse.stopProxy();
    isConnected = false;
    btn.classList.remove('connected');
    btnText.textContent = '启动代理';
    dot.className = 'conn-dot offline';
    statusText.textContent = '未连接';
    showToast('系统代理已安全关闭');
  } else {
    if (!generatedYaml) {
      await handleMergeConfig();
      if (!generatedYaml) return;
    }

    const res = await window.subfuse.startProxy({
      configPath: currentOutputPath,
      mode: currentMode,
    });

    const conflictNote = document.getElementById('single-client-note');
    if (res && res.warning) {
      if (conflictNote) conflictNote.classList.add('warn');
      showToast(res.warning);
    } else if (conflictNote) {
      conflictNote.classList.remove('warn');
    }
    if (res && res.repairedNodes && res.repairedNodes.length > 0) {
      showToast(`已自动剔除 ${res.repairedNodes.length} 个无法使用的节点，代理已正常启动`);
    }

    isConnected = true;
    btn.classList.add('connected');
    btnText.textContent = '停止代理';
    dot.className = 'conn-dot online';

    const modeLabel = currentMode === 'auto' ? '自动规则模式' : '全局代理模式';
    const procCount = allAdaptiveProcesses.length;
    statusText.textContent = `已连接 · ${modeLabel} (端口 7890 · ${procCount} 进程接管)`;
    showToast('代理已成功启动，网络已接管');
  }
}

// Failover Simulation / Test
async function handleTestFailover() {
  showToast('正在模拟 Google Chrome 遭遇网络阻断...');
  await window.subfuse.triggerProcessFailover({
    processName: 'Google Chrome',
    reason: '目标网络发生超时丢包',
  });
}

// ----------------- Application Initialization -----------------

// ------------------------------------------------------------
// 广告位占位（合规版，当前未启用）
// 现在没有广告：LOCAL_AD_SLOT 为 null，不会渲染任何内容。
// 未来接入广告时只允许以下合规形态：
//   1) 用户可见，并明确标注「广告 / 推广」；
//   2) 可一键关闭，关闭状态本地持久保存，绝不强制常驻；
//   3) 内容仅来自本地配置或 HTTPS 接口，并在应用设置中披露；
// 禁止：隐藏注入、防删除/防关闭、明文 HTTP、无披露的远程内容。
// ------------------------------------------------------------
const LOCAL_AD_SLOT = null;
// 接入示例（启用时替换上面的 null）：
// const LOCAL_AD_SLOT = {
//   title: "赞助商",
//   content: "赞助说明文字",
//   link: "https://example.com",
//   closable: true,
// };

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initCompliantAdSlot() {
  const ad = LOCAL_AD_SLOT;
  if (!ad) return; // 占位：无广告时不渲染任何内容
  try {
    if (localStorage.getItem('subfuse-ad-closed') === '1') return; // 用户已关闭，尊重选择
  } catch {}

  const container = document.createElement('div');
  container.className = 'compliant-ad-slot';
  container.innerHTML = `
    <span class="compliant-ad-tag">广告</span>
    <span class="compliant-ad-content">${escapeHtml(ad.content || '')}</span>
    ${ad.link ? `<a class="compliant-ad-link" href="${escapeHtml(ad.link)}" target="_blank" rel="noopener">详情</a>` : ''}
    <button class="compliant-ad-close" type="button" title="关闭广告">×</button>
  `;

  const closeBtn = container.querySelector('.compliant-ad-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      container.remove();
      try { localStorage.setItem('subfuse-ad-closed', '1'); } catch {}
    });
  }
  const anchor = document.querySelector('.content-body') || document.body;
  anchor.prepend(container);
}

window.addEventListener('DOMContentLoaded', async () => {
  if (window.subfuse && window.subfuse.platform === 'darwin') {
    document.body.classList.add('platform-darwin');
  }
  if (window.subfuse && window.subfuse.platform !== 'darwin') {
    const winBar = document.getElementById('win-titlebar');
    if (winBar) winBar.style.display = 'flex';
    document.getElementById('btn-win-min').addEventListener('click', () => window.subfuse.windowControl('minimize'));
    document.getElementById('btn-win-max').addEventListener('click', () => window.subfuse.windowControl('maximize'));
    document.getElementById('btn-win-close').addEventListener('click', () => window.subfuse.windowControl('close'));
  }

  currentOutputPath = await window.subfuse.getDefaultOutputPath();
  // 启动时若已有生成好的配置，直接复用，不必重新合并（动态 token 链接失效也不影响）
  const hasConfig = await window.subfuse.configFileExists(currentOutputPath);
  if (hasConfig) {
    generatedYaml = 'cached';
    const badge = document.getElementById('merge-status-badge');
    if (badge) {
      badge.className = 'status-badge ready';
      badge.textContent = '已有配置，可直接启动代理';
    }
  }

  // 恢复上一次的订阅链接，避免每次打开都要重新粘贴
  const savedSubs = loadSubscriptions();
  if (savedSubs.length > 0) {
    savedSubs.forEach(s => addSubItem(s.name || '机场', s.url));
  } else {
    addSubItem('机场 1', '');
    addSubItem('机场 2', '');
  }

  const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
  if (savedMode === 'auto' || savedMode === 'global') {
    switchMode(savedMode);
  }

  document.getElementById('tab-auto').addEventListener('click', () => switchMode('auto'));
  document.getElementById('tab-global').addEventListener('click', () => switchMode('global'));

  document.getElementById('btn-add-sub').addEventListener('click', () => addSubItem());
  document.getElementById('btn-paste-all').addEventListener('click', handlePasteAll);
  document.getElementById('btn-demo').addEventListener('click', handleLoadDemo);
  document.getElementById('btn-submit').addEventListener('click', handleMergeConfig);
  document.getElementById('btn-refresh-procs').addEventListener('click', loadAdaptiveProcesses);
  document.getElementById('btn-add-custom-proc').addEventListener('click', handleAddCustomProc);
  document.getElementById('btn-toggle-connect').addEventListener('click', handleToggleConnect);
  document.getElementById('btn-test-failover').addEventListener('click', handleTestFailover);

  const toggleNotif = document.getElementById('toggle-notif');
  toggleNotif.addEventListener('change', async () => {
    await window.subfuse.setNotificationEnabled(toggleNotif.checked);
    showToast(toggleNotif.checked ? '节点容灾切换桌面通知已开启' : '桌面通知已关闭');
  });

  window.subfuse.onGenerateProgress((data) => {
    if (data.type === 'success') {
      const found = subItems.find(i => i.name === data.name);
      if (found) {
        found.status.textContent = `${data.count} 节点`;
        found.status.className = 'sub-status ok';
      }
    } else if (data.type === 'error' || data.type === 'warning') {
      const found = subItems.find(i => i.name === data.name);
      if (found) {
        if (data.message && data.message.includes('403')) {
          found.status.textContent = '403 已跳过';
          found.status.className = 'sub-status warn';
        } else {
          found.status.textContent = '跳过';
          found.status.className = 'sub-status err';
        }
      }
    }
  });

  window.subfuse.onGuardianEvent((event) => {
    if (event.type === 'failover') {
      showToast(`已自动为【${event.payload.processName}】切换至可用节点【${event.payload.newNode}】`);
    }
  });

  await loadAdaptiveProcesses();
  initCompliantAdSlot();
});
