const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mockupDesktop', {
  saveProject: (contents, proposedName) => ipcRenderer.invoke('project:save', { contents, proposedName }),
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (filePath) => ipcRenderer.invoke('project:openPath', filePath),
  takePendingOpen: () => ipcRenderer.invoke('project:takePendingOpen'),
  onOpenFromOs: (handler) => {
    const listener = (_event, filePath) => handler(filePath);
    ipcRenderer.on('project:open-from-os', listener);
    return () => ipcRenderer.removeListener('project:open-from-os', listener);
  },
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudUse: (provider) => ipcRenderer.invoke('cloud:use', provider),
  cloudPick: () => ipcRenderer.invoke('cloud:pick'),
  cloudClear: () => ipcRenderer.invoke('cloud:clear'),
  cloudList: () => ipcRenderer.invoke('cloud:list'),
  cloudRead: (filePath) => ipcRenderer.invoke('cloud:read', filePath),
  cloudWrite: (payload) => ipcRenderer.invoke('cloud:write', payload),
  cloudRemove: (filePath) => ipcRenderer.invoke('cloud:remove', filePath),
  cloudTemplatesRead: () => ipcRenderer.invoke('cloud:templatesRead'),
  cloudTemplatesWrite: (contents) => ipcRenderer.invoke('cloud:templatesWrite', contents),
  devReadShippedTemplates: () => ipcRenderer.invoke('dev:readShippedTemplates'),
  devWriteShippedTemplates: (contents) => ipcRenderer.invoke('dev:writeShippedTemplates', contents),
  onCloudChanged: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('cloud:changed', listener);
    return () => ipcRenderer.removeListener('cloud:changed', listener);
  },
  saveImage: (dataUrl, proposedName) => ipcRenderer.invoke('image:save', { dataUrl, proposedName }),
  saveMedia: (dataBase64, proposedName, extension, mimeType) => ipcRenderer.invoke('media:save', {
    dataBase64, proposedName, extension, mimeType,
  }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  takePendingAuthCallback: () => ipcRenderer.invoke('auth:takePendingCallback'),
  onAuthCallback: (handler) => {
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('auth:callback', listener);
    return () => ipcRenderer.removeListener('auth:callback', listener);
  },
  updateStatus: () => ipcRenderer.invoke('updater:status'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onUpdateStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  getDistributionChannel: () => {
    try {
      return ipcRenderer.sendSync('distribution:channel-sync');
    } catch {
      return 'mac_direct';
    }
  },
  getInstallDeviceId: () => ipcRenderer.invoke('device:installId'),
  restorePurchases: () => ipcRenderer.invoke('iap:restore'),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  readClipboardHtml: () => ipcRenderer.invoke('clipboard:readHtml'),
  ensureCameraAccess: () => ipcRenderer.invoke('media:ensureCameraAccess'),
  figmaTokenGet: (userId) => ipcRenderer.invoke('figma:tokenGet', userId),
  figmaTokenSet: (userId, token) => ipcRenderer.invoke('figma:tokenSet', userId, token),
  figmaTokenClear: (userId) => ipcRenderer.invoke('figma:tokenClear', userId),
  figmaRequest: (apiPath, token) => ipcRenderer.invoke('figma:request', { apiPath, token }),
  figmaFetchImage: (imageUrl, token) => ipcRenderer.invoke('figma:fetchImage', { imageUrl, token }),
  androidStatus: () => ipcRenderer.invoke('android:status'),
  androidStartMirror: (serial) => ipcRenderer.invoke('android:startMirror', { serial }),
  androidStopMirror: () => ipcRenderer.invoke('android:stopMirror'),
  androidSnapshot: (serial) => ipcRenderer.invoke('android:snapshot', { serial }),
  onAndroidMirrorFrame: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('android:mirrorFrame', listener);
    return () => ipcRenderer.removeListener('android:mirrorFrame', listener);
  },
  onAndroidMirrorError: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('android:mirrorError', listener);
    return () => ipcRenderer.removeListener('android:mirrorError', listener);
  },
  convertBlend: (payload) => ipcRenderer.invoke('blend:convert', payload),
});
