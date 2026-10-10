const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paintflowDesktop", {
  saveBackup: (fileName, contents) =>
    ipcRenderer.invoke("paintflow:save-backup", { fileName, contents }),
});
