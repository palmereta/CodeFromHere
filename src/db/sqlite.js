// Thin wrapper over the built-in node:sqlite with the small subset of the
// better-sqlite3 API this project uses (prepare/run/get/all/iterate, exec,
// pragma, transaction). Using the built-in driver means no native module to
// rebuild for Electron, Windows or Linux.
import './quiet-sqlite-warning.js'

// Dynamic import: static imports of builtins are loaded while linking, before
// the warning filter above has run.
const { DatabaseSync } = await import('node:sqlite')

export default class Database {
  constructor(file) {
    this.db = new DatabaseSync(file)
    this.depth = 0
  }

  prepare(sql) { return this.db.prepare(sql) }
  exec(sql) { this.db.exec(sql) }
  close() { this.db.close() }

  /** pragma('user_version', { simple: true }) → value; pragma('x = 1') → rows */
  pragma(expr, { simple = false } = {}) {
    const rows = this.db.prepare(`PRAGMA ${expr}`).all()
    if (!simple) return rows
    const first = rows[0]
    return first ? Object.values(first)[0] : undefined
  }

  /** Returns a function that runs fn inside a transaction (savepoints when nested). */
  transaction(fn) {
    return (...args) => {
      const sp = `sp_${this.depth}`
      this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
      this.depth++
      try {
        const out = fn(...args)
        this.depth--
        this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
        return out
      } catch (err) {
        this.depth--
        this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
        throw err
      }
    }
  }
}
