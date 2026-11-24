const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openPdf: () => ipcRenderer.invoke('open-pdf'),
  openImage: () => ipcRenderer.invoke('open-image'),
  openImages: () => ipcRenderer.invoke('open-images'),
  readPath: (p) => ipcRenderer.invoke('read-path', p),
  savePdf: (o) => ipcRenderer.invoke('save-pdf', o),
  saveFile: (o) => ipcRenderer.invoke('save-file', o),
  printPdf: (o) => ipcRenderer.invoke('print-pdf', o),
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
  closeNow: () => ipcRenderer.send('close-now'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, a) => cb(a)),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, f) => cb(f)),
});
