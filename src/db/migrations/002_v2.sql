-- v2: site groups, more protocols, host-key pinning, persistent HTTP sessions,
-- user preferences/layout, per-folder AI workspaces, RBAC, MFA and a
-- tamper-evident audit log.

-- Users: roles, MFA, lockout -------------------------------------------------
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
UPDATE users SET role = 'admin' WHERE username = 'admin';

-- Site groups (nested folders) ----------------------------------------------
CREATE TABLE connection_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES connection_groups(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    collapsed   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_groups_user ON connection_groups(user_id);

-- Connections: rebuild to widen the protocol CHECK and add new columns -------
CREATE TABLE connections_v2 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id        INTEGER REFERENCES connection_groups(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK(type IN ('ssh','sftp','scp','ftp','ftps','s3','telnet')),
    host            TEXT,
    port            INTEGER,
    username        TEXT,
    password        TEXT,
    private_key     TEXT,
    passphrase      TEXT,
    ssh_key_id      INTEGER REFERENCES ssh_keys(id) ON DELETE SET NULL,
    use_agent       INTEGER NOT NULL DEFAULT 0,
    jump_id         INTEGER REFERENCES connections_v2(id) ON DELETE SET NULL,
    root_path       TEXT DEFAULT '/',
    bucket          TEXT,
    region          TEXT DEFAULT 'us-east-1',
    endpoint        TEXT,
    access_key      TEXT,
    secret_key      TEXT,
    ftps_implicit   INTEGER NOT NULL DEFAULT 0,
    tls_verify      INTEGER NOT NULL DEFAULT 1,
    use_tmux        INTEGER NOT NULL DEFAULT 0,
    startup_command TEXT,
    encoding        TEXT DEFAULT 'utf8',
    tags            TEXT,
    notes           TEXT,
    color           TEXT DEFAULT '#6366f1',
    sort_order      INTEGER DEFAULT 0,
    last_connected  TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);
INSERT INTO connections_v2 (id, user_id, name, type, host, port, username, password, private_key,
    passphrase, root_path, bucket, region, endpoint, access_key, secret_key, color, sort_order,
    last_connected, created_at, updated_at)
  SELECT id, user_id, name, type, host, port, username, password, private_key, passphrase,
    root_path, bucket, region, endpoint, access_key, secret_key, color, sort_order,
    last_connected, created_at, updated_at
  FROM connections;
DROP TABLE connections;
ALTER TABLE connections_v2 RENAME TO connections;
CREATE INDEX idx_connections_user ON connections(user_id);

-- Single-use URL tokens are replaced by cookie + Origin-checked WebSockets.
DROP TABLE IF EXISTS terminal_tokens;

-- Pinned SSH host keys (trust on first use, then strict) --------------------
CREATE TABLE known_hosts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL,
    key_type     TEXT,
    fingerprint  TEXT NOT NULL,
    created_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, host, port)
);

-- Server-side HTTP sessions (survive restarts, can be revoked) --------------
CREATE TABLE http_sessions (
    sid         TEXT PRIMARY KEY,
    user_id     INTEGER,
    data        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    ip          TEXT,
    user_agent  TEXT
);
CREATE INDEX idx_http_sessions_user ON http_sessions(user_id);

-- Preferences (Hyper-style config) and saved layouts ------------------------
CREATE TABLE user_prefs (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL DEFAULT '{}',
    layout_json TEXT,
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Per-folder AI workspaces: system prompt, default agent, saved context ------
CREATE TABLE workspaces (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id  INTEGER REFERENCES connections(id) ON DELETE CASCADE, -- NULL = local machine
    path           TEXT NOT NULL,
    name           TEXT NOT NULL,
    system_prompt  TEXT,
    agent          TEXT,            -- claude | codex | opencode | shell
    agent_args     TEXT,
    env_json       TEXT,
    context        TEXT,            -- free-form notes / saved context
    inherit        INTEGER NOT NULL DEFAULT 1, -- also apply to sub-folders
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_workspaces_unique ON workspaces(user_id, IFNULL(connection_id, 0), path);

-- Tamper-evident audit log: each row hashes the previous one ----------------
ALTER TABLE audit_log ADD COLUMN details TEXT;
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN hash TEXT;
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
