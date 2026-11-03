// CodeFromHere desktop shell (macOS, Windows, Linux).
// Starts the same Fastify server as the web edition in a utility process,
// bound to 127.0.0.1 on a random port, and opens it in a locked-down window.
const { app, BrowserWindow, Menu, shell, safeStorage, utilityProcess, session, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

const isMac = process.platform === 'darwin'
const dataDir = path.join(app.getPath('userData'), 'data')
let server = null
let serverUrl = null
let mainWindow = null

/** Secrets live in the OS keychain (Keychain / DPAPI / libsecret) via safeStorage. */
function loadSecrets() {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const file = path.join(app.getPath('userData'), 'secrets.bin')
  const canEncrypt = safeStorage.isEncryptionAvailable()
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file)
    try { return JSON.parse(canEncrypt ? safeStorage.decryptString(raw) : raw.toString('utf8')) } catch {}
  }
  const secrets = { encryption: crypto.randomBytes(48).toString('base64url'), session: crypto.randomBytes(48).toString('base64url') }
  const json = JSON.stringify(secrets)
  fs.writeFileSync(file, canEncrypt ? safeStorage.encryptString(json) : json, { mode: 0o600 })
  return secrets
}

function startServer() {
  return new Promise((resolve, reject) => {
    const secrets = loadSecrets()
    const token = crypto.randomBytes(32).toString('base64url')
    const entry = path.join(__dirname, '..', 'server.js')
    server = utilityProcess.fork(entry, [], {
      serviceName: 'CodeFromHere server',
      stdio: 'pipe',
      env: {
        ...process.env,
        CFH_MODE: 'desktop',
        CFH_DATA_DIR: dataDir,
        CFH_DESKTOP_TOKEN: token,
        ENCRYPTION_KEY: secrets.encryption,
        SESSION_SECRET: secrets.session,
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: process.env.CFH_LOG_LEVEL || 'warn',
      },
    })
    server.stdout?.on('data', (d) => process.stdout.write(d))
    server.stderr?.on('data', (d) => process.stderr.write(d))
    const timer = setTimeout(() => reject(new Error('Server did not start within 30s')), 30000)
    server.on('message', (msg) => {
      if (msg?.type === 'listening') {
        clearTimeout(timer)
        serverUrl = `http://127.0.0.1:${msg.port}`
        resolve({ url: serverUrl, token })
      }
    })
    server.on('exit', (code) => {
      clearTimeout(timer)
      if (!app.isQuitting) {
        dialog.showErrorBox('CodeFromHere', `The background server stopped (code ${code}). The app will close.`)
        app.quit()
      }
    })
  })
}

function hardenSession() {
  const ses = session.defaultSession
  // Only what a terminal needs.
  const allowed = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
}

function createWindow({ url, token }) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#000000',
    title: 'CodeFromHere',
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 11 } : undefined,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Links open in the system browser; the app never navigates away.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target) && !target.startsWith(url)) shell.openExternal(target)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(url)) e.preventDefault() })

  mainWindow.loadURL(`${url}/api/auth/desktop?token=${encodeURIComponent(token)}`)
  mainWindow.on('closed', () => { mainWindow = null })
}

function buildMenu() {
  // No accelerators for Cmd/Ctrl+W, T, D…: those belong to the terminal UI.
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [])] },
    { role: 'help', submenu: [{ label: 'Project page', click: () => shell.openExternal('https://github.com/palmereta/CodeFromHere') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })

app.whenReady().then(async () => {
  hardenSession()
  buildMenu()
  try {
    const srv = await startServer()
    createWindow(srv)
    app.on('activate', async () => {
      // macOS: reopening after closing the window keeps the same sessions; a new
      // desktop token is not needed because the session cookie is still valid.
      if (!mainWindow) {
        createWindow({ url: serverUrl, token: '' })
        mainWindow.loadURL(serverUrl)
      }
    })
  } catch (err) {
    dialog.showErrorBox('CodeFromHere', `Could not start: ${err.message}`)
    app.quit()
  }
})

// Closing the window on macOS keeps terminals running (re-open from the Dock).
app.on('window-all-closed', () => { if (!isMac) app.quit() })
app.on('before-quit', () => { app.isQuitting = true; try { server?.kill() } catch {} })
