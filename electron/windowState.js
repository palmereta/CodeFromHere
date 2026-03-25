import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function getStatePath() {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'window-state.json')
}

export function loadWindowState() {
  try {
    const data = readFileSync(getStatePath(), 'utf8')
    return JSON.parse(data)
  } catch {
    return { width: 1400, height: 900, maximized: false }
  }
}

export function saveWindowState(state) {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    writeFileSync(getStatePath(), JSON.stringify(state))
  } catch {}
}
