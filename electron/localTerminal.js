import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import os from 'os'

let pty = null
let ptyAvailable = null // null = not checked, true/false

const terminals = new Map()
let nextId = 1

async function loadPty() {
  if (ptyAvailable !== null) return ptyAvailable
  try {
    const mod = await import('node-pty')
    pty = mod.default || mod
    // Test that it actually works by checking spawn exists
    if (typeof pty.spawn !== 'function') throw new Error('spawn not found')
    // Try a quick spawn to verify native module works
    const test = pty.spawn('/bin/echo', ['test'], { name: 'xterm', cols: 10, rows: 1 })
    test.kill()
    ptyAvailable = true
    console.log('node-pty loaded and working')
  } catch (e) {
    ptyAvailable = false
    console.log('node-pty not usable (' + e.message + '), using child_process fallback')
  }
  return ptyAvailable
}

export function setupLocalTerminal(mainWindow) {
  ipcMain.handle('pty:spawn', async (event, options = {}) => {
    const id = `local-${nextId++}`
    const shell = process.env.SHELL || '/bin/zsh'
    const cwd = options.cwd || os.homedir()
    const cols = options.cols || 120
    const rows = options.rows || 30

    const hasPty = await loadPty()

    if (hasPty) {
      // Full PTY mode
      const term = pty.spawn(shell, ['--login'], {
        name: 'xterm-256color',
        cols, rows, cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      })

      terminals.set(id, { type: 'pty', proc: term })

      term.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:data', id, data)
        }
      })

      term.onExit(({ exitCode }) => {
        terminals.delete(id)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:exit', id, exitCode)
        }
      })
    } else {
      // Fallback: child_process with pseudo-interactive mode
      const proc = spawn(shell, ['-i'], {
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      terminals.set(id, { type: 'child', proc })

      proc.stdout.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:data', id, data.toString())
        }
      })

      proc.stderr.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:data', id, data.toString())
        }
      })

      proc.on('exit', (code) => {
        terminals.delete(id)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:exit', id, code)
        }
      })
    }

    return id
  })

  ipcMain.on('pty:write', (event, id, data) => {
    const entry = terminals.get(id)
    if (!entry) return
    if (entry.type === 'pty') entry.proc.write(data)
    else entry.proc.stdin.write(data)
  })

  ipcMain.on('pty:resize', (event, id, cols, rows) => {
    const entry = terminals.get(id)
    if (!entry) return
    try {
      if (entry.type === 'pty') entry.proc.resize(cols, rows)
      // child_process doesn't support resize
    } catch {}
  })

  ipcMain.on('pty:kill', (event, id) => {
    const entry = terminals.get(id)
    if (!entry) return
    try {
      if (entry.type === 'pty') entry.proc.kill()
      else entry.proc.kill('SIGTERM')
    } catch {}
    terminals.delete(id)
  })

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  // Cleanup
  mainWindow.on('closed', () => {
    for (const [id, entry] of terminals) {
      try {
        if (entry.type === 'pty') entry.proc.kill()
        else entry.proc.kill('SIGTERM')
      } catch {}
    }
    terminals.clear()
  })
}
