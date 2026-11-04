const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mockupDesktop', {
  saveProject: (contents, proposedName) => ipcRenderer.invoke('project:save', { contents, proposedName }),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveImage: (dataUrl, proposedName) => ipcRenderer.invoke('image:save', { dataUrl, proposedName }),
  saveMedia: (dataBase64, proposedName, extension, mimeType) => ipcRenderer.invoke('media:save', {
    dataBase64, proposedName, extension, mimeType,
  }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
