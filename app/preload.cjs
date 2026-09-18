// 预加载脚本刻意写成 CommonJS：沙箱化的 preload 在多数 Electron 版本里不吃 ESM。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voicepilot", {
  analyze: (text) => ipcRenderer.invoke("voicepilot:analyze", text),
  configVersions: () => ipcRenderer.invoke("voicepilot:configVersions"),
  revealConfig: () => ipcRenderer.invoke("voicepilot:revealConfig"),
  platform: process.platform,
});
