// 预加载脚本：向渲染进程暴露最小必要的窗口控制接口。
//
// 必须用 CommonJS（.cjs）：渲染进程默认是沙箱模式，ESM 语法的预加载脚本
// 在沙箱下不会被加载（旧版 preload.js 用了 import，导致 window.app 为
// undefined —— 界面上的窗口按钮点了没反应）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getPorts: () => ipcRenderer.invoke('app:ports'),
  // 主进程在最大化/还原时通知渲染层，便于切换按钮图标
  onMaximizeChanged: (cb) => {
    const handler = (_e, v) => cb(!!v);
    ipcRenderer.on('window:maximize-changed', handler);
    return () => ipcRenderer.removeListener('window:maximize-changed', handler);
  },
});
