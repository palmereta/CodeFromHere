// Central runtime configuration. Everything that depends on environment
// variables is resolved here once, so the rest of the code never reads
// process.env directly.
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'

const env = process.env

/** 'web' = multi-user server; 'desktop' = embedded single-user server started by Electron. */
export const MODE = env.CFH_MODE === 'desktop' ? 'desktop' : 'web'

export const DATA_DIR = resolve(env.CFH_DATA_DIR || join(process.cwd(), 'data'))
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

/**
 * Secrets: prefer explicit env vars (or a KMS that injects them). If missing,
 * generate once and persist with 0600 permissions so restarts keep working.
 * A warning is printed because co-locating the key with the DB is weaker.
 */
function persistentSecret(name, envValue) {
  if (envValue && envValue.length >= 32) return envValue
  const file = join(DATA_DIR, `${name}.key`)
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const value = randomBytes(48).toString('base64url')
  writeFileSync(file, value + '\n', { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch {}
  if (MODE === 'web') {
    console.warn(`[security] ${name} not set in the environment; generated ${file}. ` +
      'For production keep it outside the data directory (env var or secrets manager).')
  }
  return value
}

export const ENCRYPTION_KEY = persistentSecret('encryption', env.ENCRYPTION_KEY)
export const SESSION_SECRET = persistentSecret('session', env.SESSION_SECRET)

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10))
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()))

export const config = {
  mode: MODE,
  dataDir: DATA_DIR,
  host: env.HOST || (MODE === 'desktop' ? '127.0.0.1' : '0.0.0.0'),
  port: int(env.PORT, 3000),
  logLevel: env.LOG_LEVEL || 'info',
  /** Set when running behind a TLS-terminating reverse proxy. */
  trustProxy: bool(env.TRUST_PROXY, false),
  /** Cookies get the Secure flag. Defaults on unless explicitly disabled (dev over http). */
  secureCookies: bool(env.SECURE_COOKIES, MODE === 'web' && env.NODE_ENV === 'production'),
  hsts: bool(env.ENABLE_HSTS, false),
  /** Local shell on the machine that runs the server. Always on for desktop, opt-in for web. */
  allowLocalShell: MODE === 'desktop' ? true : bool(env.ALLOW_LOCAL_SHELL, false),
  /** Session lifetime (OWASP ASVS 3.3): idle and absolute timeouts, minutes. */
  sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, MODE === 'desktop' ? 60 * 24 * 30 : 30),
  sessionAbsoluteHours: int(env.SESSION_ABSOLUTE_HOURS, MODE === 'desktop' ? 24 * 365 : 12),
  /** How long a terminal keeps running with no browser attached, minutes. */
  terminalDetachMinutes: int(env.TERMINAL_DETACH_MINUTES, MODE === 'desktop' ? 60 * 24 * 7 : 60),
  terminalScrollbackBytes: int(env.TERMINAL_SCROLLBACK_BYTES, 2 * 1024 * 1024),
  maxTerminalsPerUser: int(env.MAX_TERMINALS_PER_USER, MODE === 'desktop' ? 200 : 40),
  uploadLimitBytes: int(env.UPLOAD_LIMIT_MB, 1024) * 1024 * 1024,
  /** Account lockout (SOC2 CC6.1 / OWASP ASVS 2.2). */
  lockoutThreshold: int(env.LOCKOUT_THRESHOLD, 8),
  lockoutMinutes: int(env.LOCKOUT_MINUTES, 15),
  passwordMinLength: int(env.PASSWORD_MIN_LENGTH, 12),
  /** One-time token Electron passes to auto-login the local desktop user. */
  desktopToken: env.CFH_DESKTOP_TOKEN || null,
  home: homedir(),
}
