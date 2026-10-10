const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paintflowDesktop", {
  saveBackup: (fileName, token) => ipcRenderer.invoke("paintflow:save-backup", { fileName, token }),
});
