const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isDesktop: true,
  platform: process.platform,
  databaseHealth: () => ipcRenderer.invoke("db:health"),
  cloudPull: (payload) => ipcRenderer.invoke("cloud:pull", payload),
  cloudPush: (payload) => ipcRenderer.invoke("cloud:push", payload),
  createImageUploadUrl: (payload) => ipcRenderer.invoke("image:create-upload-url", payload),
  registerImageAsset: (payload) => ipcRenderer.invoke("image:register-asset", payload),
  saveInvoiceDocument: (payload) => ipcRenderer.invoke("invoice:save-document", payload),
});
