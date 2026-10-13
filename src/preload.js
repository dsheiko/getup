const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("getup", {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  },
  onRemind: (callback) => {
    const listener = (_event, reminder) => callback(reminder);
    ipcRenderer.on("remind", listener);
    return () => ipcRenderer.removeListener("remind", listener);
  },
  takeBreak: () => ipcRenderer.send("break:take"),
  startBreak: () => ipcRenderer.send("break:start"),
  endBreak: () => ipcRenderer.send("break:end"),
  snooze: () => ipcRenderer.send("break:snooze"),
  pause: () => ipcRenderer.send("pause:start"),
  resume: () => ipcRenderer.send("pause:resume"),
  updateSettings: (patch) => ipcRenderer.send("settings:update", patch),
  setTrayIcon: (images) => ipcRenderer.send("tray:icon", images),
  setHeight: (height) => ipcRenderer.send("window:height", height),
});
