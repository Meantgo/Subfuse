import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('subfuse', {
  platform: process.platform,
  generateConfig: (options) => ipcRenderer.invoke('generate-config', options),
  onGenerateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('generate-progress', handler);
    return () => ipcRenderer.removeListener('generate-progress', handler);
  },
  writeConfigFile: (options) => ipcRenderer.invoke('write-config-file', options),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openDirectory: (dirPath) => ipcRenderer.invoke('open-directory', dirPath),
  getDefaultOutputPath: () => ipcRenderer.invoke('get-default-output-path'),
  configFileExists: (filePath) => ipcRenderer.invoke('config-file-exists', filePath),
  selectOutputFile: (defaultPath) => ipcRenderer.invoke('select-output-file', defaultPath),
  testSingleSubscription: (options) => ipcRenderer.invoke('test-single-subscription', options),
  parseSingleNodeUri: (uri) => ipcRenderer.invoke('parse-single-node-uri', uri),
  fetchClashStatus: (options) => ipcRenderer.invoke('fetch-clash-status', options),
  windowControl: (action) => ipcRenderer.send('window-control', action),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Process Adaptation & Guardian APIs
  getAdaptiveProcesses: (customRules) => ipcRenderer.invoke('get-adaptive-processes', customRules),
  startProxy: (options) => ipcRenderer.invoke('start-proxy', options),
  stopProxy: () => ipcRenderer.invoke('stop-proxy'),
  getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
  getLiveConnections: () => ipcRenderer.invoke('get-live-connections'),
  getGuardianState: () => ipcRenderer.invoke('get-guardian-state'),
  setNotificationEnabled: (enabled) => ipcRenderer.invoke('set-notification-enabled', enabled),
  triggerProcessFailover: (options) => ipcRenderer.invoke('trigger-process-failover', options),
  previewSubscriptions: (options) => ipcRenderer.invoke('preview-subscriptions', options),
  onGuardianEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('guardian-event', handler);
    return () => ipcRenderer.removeListener('guardian-event', handler);
  },
});
