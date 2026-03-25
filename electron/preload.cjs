const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // Local terminal via node-pty
  spawnLocalTerminal: (options) => ipcRenderer.invoke('pty:spawn', options),
  writeToTerminal: (id, data) => ipcRenderer.send('pty:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  killTerminal: (id) => ipcRenderer.send('pty:kill', id),
  onTerminalData: (callback) => {
    ipcRenderer.on('pty:data', (_, id, data) => callback(id, data))
  },
  onTerminalExit: (callback) => {
    ipcRenderer.on('pty:exit', (_, id, code) => callback(id, code))
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Menu actions (received from main)
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:action', (_, action) => callback(action))
  },
})
