// Minimal, read-only bridge. The renderer talks to the local server over HTTP
// like the web edition; nothing else from Node is exposed.
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('cfhDesktop', Object.freeze({ platform: process.platform }))
