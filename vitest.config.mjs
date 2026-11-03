import { defineConfig } from 'vitest/config'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 2,
    env: {
      CFH_DATA_DIR: mkdtempSync(join(tmpdir(), 'cfh-test-')),
      ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghijklmnop',
      SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnop',
      LOG_LEVEL: 'silent',
    },
  },
})
