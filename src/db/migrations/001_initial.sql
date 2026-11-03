CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK(type IN ('sftp','ftp','ftps','s3')),
    host            TEXT,
    port            INTEGER,
    username        TEXT,
    password        TEXT,
    private_key     TEXT,
    passphrase      TEXT,
    root_path       TEXT DEFAULT '/',
    bucket          TEXT,
    region          TEXT DEFAULT 'us-east-1',
    endpoint        TEXT,
    access_key      TEXT,
    secret_key      TEXT,
    color           TEXT DEFAULT '#6366f1',
    sort_order      INTEGER DEFAULT 0,
    last_connected  TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ssh_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    private_key TEXT NOT NULL,
    public_key  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS terminal_tokens (
    token           TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    connection_id   INTEGER NOT NULL,
    initial_path    TEXT DEFAULT '/',
    used            INTEGER DEFAULT 0,
    expires_at      TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    connection_id   INTEGER,
    action          TEXT NOT NULL,
    path            TEXT,
    ip              TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
