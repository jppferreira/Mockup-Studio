const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mockupDesktop', {
  saveProject: (contents, proposedName) => ipcRenderer.invoke('project:save', { contents, proposedName }),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveImage: (dataUrl, proposedName) => ipcRenderer.invoke('image:save', { dataUrl, proposedName }),
  saveMedia: (dataBase64, proposedName, extension, mimeType) => ipcRenderer.invoke('media:save', {
    dataBase64, proposedName, extension, mimeType,
  }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  ensureCameraAccess: () => ipcRenderer.invoke('media:ensureCameraAccess'),
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
});
