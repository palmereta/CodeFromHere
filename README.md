<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0--alpha-f81ce5" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D22.13-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/desktop-macOS%20%7C%20Windows%20%7C%20Linux-black" alt="Desktop">
  <img src="https://img.shields.io/badge/protocols-SSH%20%7C%20SFTP%20%7C%20SCP%20%7C%20FTP(S)%20%7C%20S3%20%7C%20Telnet-purple" alt="Protocols">
</p>

# CodeFromHere

**A terminal, remote-site manager and file-transfer tool in one app — built for working with AI coding agents.**
Runs as a desktop app (macOS, Windows, Linux) or as a self-hosted web app you open from any browser.

> v2 is a rewrite of the original CodeFromHere web IDE. See [CHANGELOG.md](CHANGELOG.md).

---

## Features

**Terminal**
- Hyper-style look: black, flat tabs with centered titles, configurable via a JSON config (like `~/.hyper.js`) or a settings UI. 8 built-in themes; every color can be overridden.
- Tabs **and** grids: drag any tab to an edge to split; tile everything into a grid or stack it back into tabs. Terminals, editors and file managers are all panels.
- GPU rendering (xterm.js + WebGL), true color, Unicode 11, links, search, copy-on-select.
- **Sessions survive the UI.** Closing the window or reloading only detaches; the shell keeps running on the server and you get back exactly what you missed. SSH sites can also run inside `tmux` so even a server restart is recoverable.
- Layout and preferences are saved per user and restored on any device.

**AI agents (Claude Code, Codex, OpenCode)**
- One-click agent tabs, locally or on any SSH site.
- **Per-folder system prompts ("AI workspaces")** with saved context. Injected automatically when an agent starts in that folder or a sub-folder:
  `--append-system-prompt-file` (Claude Code), `developer_instructions` (Codex), `instructions` (OpenCode). Plus a global prompt.
- **Resume sessions:** browse previous Claude / Codex / OpenCode conversations for the current folder and reopen them. Restored agent tabs resume their conversation.
- "Waiting for you" alerts: OSC 9 / OSC 777 / bell notifications and an idle detector for background agent tabs.
- Drag files from the explorer into a terminal to paste their paths into the agent prompt.

**Remote sites (like Termius / FileZilla Pro)**
- SSH, SFTP, SCP (shell-based, for servers without SFTP), FTP, FTPS (explicit/implicit), S3-compatible storage (AWS, MinIO, Wasabi, B2, R2), Telnet.
- Nested groups with drag & drop, colors, tags, notes, jump hosts, startup commands, ssh-agent (desktop).
- Import from `~/.ssh/config`, FileZilla `sitemanager.xml` and CSV.

**Files**
- Dual-pane file manager between **any two sources**: local ⇄ SFTP, FTP → S3, S3 → SFTP…
- Transfer queue with parallel workers, retries, pause/resume/cancel, overwrite policies (overwrite, skip, if newer, if size differs, keep both, **resume partial files**), move, preserved timestamps.
- Folder comparison and one-click sync.
- Monaco editor (VS Code's engine) with conflict detection when the remote file changed.

**Security** — designed to support SOC 2 and OWASP ASVS controls: MFA (TOTP), RBAC, account lockout, server-side revocable sessions, strict CSP without CDNs, CSRF protection, AES-256-GCM credentials at rest, SSH host-key pinning, tamper-evident audit log. See [docs/SECURITY-CONTROLS.md](docs/SECURITY-CONTROLS.md).

## Install

### Desktop

Download the installer for your OS from [Releases](https://github.com/palmereta/CodeFromHere/releases) (`.dmg`, `.exe`, `.AppImage`, `.deb`).
The desktop app runs its server privately on `127.0.0.1`, signs you in automatically and keeps its keys in the OS keychain.

> Builds are unsigned until signing certificates are configured: on macOS right-click → Open the first time; on Windows choose "More info → Run anyway".

### Web (self-hosted)

```bash
docker run -d --name codefromhere -p 3000:3000 -v cfh-data:/data \
  -e ENCRYPTION_KEY="$(openssl rand -base64 48)" \
  -e SESSION_SECRET="$(openssl rand -base64 48)" \
  ghcr.io/palmereta/codefromhere:latest
docker logs codefromhere   # the first admin password is printed once
```

Or from source (Node ≥ 22.13):

```bash
git clone https://github.com/palmereta/CodeFromHere.git && cd CodeFromHere
npm ci && npm run build
cp .env.example .env   # set ENCRYPTION_KEY and SESSION_SECRET
npm start
```

Put it behind HTTPS (Caddy, nginx, Traefik) and set `TRUST_PROXY=1`, `SECURE_COOKIES=1`, `ENABLE_HSTS=1`.
`ALLOW_LOCAL_SHELL=1` gives admins a shell and file access **on the server itself** — leave it off unless that is what you want.

## Development

```bash
npm ci
npm run dev        # API on :3000 (with --watch) + Vite on :5173
npm run desktop    # Electron window against a fresh build
npm test           # backend tests
npm run typecheck
npm run dist:mac   # or dist:win / dist:linux — installers in ./release
```

Releases: push a tag `vX.Y.Z` → GitHub Actions builds the three desktop installers, attaches them to a draft release and publishes the Docker image.

## Keyboard

| Action | macOS (desktop) | Windows / Linux (desktop) | Browser |
|---|---|---|---|
| New tab | ⌘T | Ctrl+Shift+T | Alt+Shift+T |
| Close tab | ⌘W | Ctrl+Shift+W | Alt+Shift+W |
| Split right / down | ⌘D / ⌘⇧D | Ctrl+Shift+D / Ctrl+Shift+Alt+D | Alt+Shift+D / Alt+Shift+Ctrl+D |
| Command palette | ⌘⇧P | Ctrl+Shift+P | Alt+Shift+P |
| Toggle sidebar | ⌘B | Ctrl+Shift+B | Alt+Shift+B |
| Next / previous tab | ⌘] / ⌘[ | Ctrl+Shift+] / [ | Alt+Shift+] / [ |
| Go to tab N | ⌘1…9 | Ctrl+Shift+1…9 | Alt+Shift+1…9 |

All shortcuts are editable in Settings → Keyboard.

## Architecture

```
server.js              Fastify app (HTTP API + WebSockets), shared by web and desktop
src/sessions/          persistent terminal sessions: local PTY, SSH, Telnet, AI agent launch
src/services/vfs/      one interface over local, SFTP, SCP, FTP(S), S3 (streams, resume)
src/transfers/         transfer queue, compare & sync
src/security/          auth, sessions, CSRF/CSP, crypto, audit
ui/                    React + dockview + xterm.js + Monaco (built by Vite into dist/ui)
desktop/               Electron shell (utility process + hardened BrowserWindow)
```

SQLite (Node's built-in `node:sqlite`) stores users, sites, preferences and the audit log. No native modules besides `node-pty` (N-API), so the same build runs in Node and Electron.

## License

MIT
