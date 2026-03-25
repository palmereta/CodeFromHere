import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { setupLocalTerminal } from './localTerminal.js'
import { createMenu } from './menu.js'
import { loadWindowState, saveWindowState } from './windowState.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

process.env.ELECTRON = '1'
process.env.HOST = '127.0.0.1'

// Auto-generate crypto keys if not set (desktop mode doesn't use .env)
import { randomBytes } from 'crypto'
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex')
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
}

let mainWindow

async function startApp() {
  // Start Fastify server directly (native modules rebuilt for Electron)
  let serverPort
  try {
    const { startServer } = await import('../server.js')
    serverPort = await startServer(0) // port 0 = OS picks free port
    console.log(`Fastify on port ${serverPort}`)
  } catch (err) {
    console.error('Failed to start server:', err.message, err.stack)
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
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // allow preload with HTTP URLs
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`)

  // Forward renderer console to main process stdout (debug)
  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.error('[renderer]', message) // only warnings/errors
  })

  // Open DevTools in development
  if (process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools()
  }

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

app.on('window-all-closed', () => app.quit())

app.on('activate', () => {
  if (!mainWindow) startApp()
})
