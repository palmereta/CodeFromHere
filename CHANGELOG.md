# Changelog

## 2.0.0-alpha.1

Rewrite. CodeFromHere becomes a terminal-first app for desktop and web.

### Added
- Desktop app (Electron) for macOS, Windows and Linux; Docker image for the web edition.
- Hyper-style UI with tabs and drag & drop grid (dockview), command palette, 8 themes, JSON config, editable shortcuts.
- Persistent terminal sessions (survive reloads and disconnects), local shell, SSH with jump hosts / ssh-agent / tmux, Telnet.
- AI agent tabs for Claude Code, Codex and OpenCode; per-folder system prompts and saved context; conversation history and resume; agent idle and OSC notifications.
- Site groups (nested, drag & drop), tags, colors; SCP and Telnet site types; import from ~/.ssh/config, FileZilla and CSV.
- Dual-pane file manager between any sources; streaming transfer queue with retries, pause/resume, overwrite policies, partial-file resume, move, compare & sync.
- MFA (TOTP), roles, account lockout, revocable server-side sessions, admin console, tamper-evident audit log with export.

### Changed
- Fastify 5, xterm.js 6, Monaco bundled locally (no CDNs), React UI built with Vite.
- Database uses Node's built-in SQLite with versioned migrations; credentials re-encrypted with an scrypt-derived key (v1 data is migrated automatically).
- Terminal WebSockets authenticate with the session cookie and check Origin (no tokens in URLs); binary frames for data.

### Security fixes from v1
- SSH host keys were not verified (MITM) → pinned per user.
- FTPS accepted any certificate → verified by default.
- CSP allowed `unsafe-eval` and third-party CDNs → strict self-only scripts.
- Session cookie not `Secure`/`Strict`, in-memory store → hardened, server-side, revocable.
- Terminal input starting with `{` could be swallowed as a control message → separate binary/text channels.
