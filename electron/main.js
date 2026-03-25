import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawn, execSync } from 'child_process'
import { setupLocalTerminal } from './localTerminal.js'
import { createMenu } from './menu.js'
import { loadWindowState, saveWindowState } from './windowState.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

process.env.ELECTRON = '1'

let mainWindow
let serverProcess

// Find system Node binary (not Electron's)
function findNodeBinary() {
  try {
    return execSync('which node', { encoding: 'utf8' }).trim()
  } catch {
    // Common paths
    const paths = ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']
    for (const p of paths) {
      try { execSync(`test -f ${p}`); return p } catch {}
    }
    return 'node' // fallback, hope it's in PATH
  }
}

// Start Fastify as a child process using SYSTEM Node (not Electron's Node)
function startServerProcess() {
  return new Promise((resolve, reject) => {
    const nodeBin = findNodeBinary()
    console.log(`Using system Node: ${nodeBin}`)

    serverProcess = spawn(nodeBin, [join(rootDir, 'server.js')], {
      cwd: rootDir,
      env: { ...process.env, ELECTRON: '1', PORT: '0', HOST: '127.0.0.1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let resolved = false

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString()
      console.log('[server]', msg.trim())
      // Look specifically for our startup message with the port
      const match = msg.match(/corriendo en http:\/\/[\w.-]+:(\d+)/)
      if (match && !resolved) {
        resolved = true
        resolve(parseInt(match[1]))
      }
    })

    serverProcess.stderr.on('data', (data) => {
      console.error('[server]', data.toString().trim())
    })

    serverProcess.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err) }
    })

    serverProcess.on('exit', (code) => {
      console.log(`[server] exited with code ${code}`)
      if (!resolved) { resolved = true; reject(new Error(`Server exited: ${code}`)) }
    })

    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('Server start timeout')) }
    }, 15000)
  })
}

async function startApp() {
  let serverPort
  try {
    serverPort = await startServerProcess()
    console.log(`Fastify on port ${serverPort}`)
  } catch (err) {
    console.error('Failed to start server:', err.message)
    app.quit()
    return
  }

  const state = loadWindowState()

  mainWindow = new BrowserWindow({
    width: state.width || 1400,
    height: state.height || 900,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`)

  // Save window state
  let saveTimeout
  const debouncedSave = () => {
    clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
        saveWindowState({ ...mainWindow.getBounds(), maximized: false })
      }
    }, 500)
  }
  mainWindow.on('resize', debouncedSave)
  mainWindow.on('move', debouncedSave)
  mainWindow.on('closed', () => { mainWindow = null })

  setupLocalTerminal(mainWindow)
  createMenu(mainWindow)

  if (state.maximized) mainWindow.maximize()
}

app.whenReady().then(startApp)

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null }
  app.quit()
})

app.on('activate', () => {
  if (!mainWindow) startApp()
})

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null }
})
