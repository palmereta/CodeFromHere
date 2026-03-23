<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/database-SQLite-003B57" alt="SQLite">
  <img src="https://img.shields.io/badge/protocols-SFTP%20%7C%20FTP%20%7C%20FTPS%20%7C%20S3-purple" alt="Protocols">
</p>

# CodeFromHere

**An open-source, self-hosted Web IDE for remote server management.**

> *For everyone who opened CodeAnywhere one morning and found it was gone.*

CodeAnywhere Legacy was discontinued without warning, leaving thousands of developers without the tool they relied on daily to manage their servers, edit files, and deploy code from any browser. No export, no migration path, no goodbye.

**CodeFromHere** is built from that frustration. It's a love letter to what CodeAnywhere was --- a fast, browser-based IDE that let you connect to any server and just *work* --- rebuilt as a single self-hosted Node.js application that you own, control, and will never lose access to.

One process. One port. Your servers. Your data. Forever.

---

## What It Does

CodeFromHere gives you a full IDE experience in your browser, connected to your remote servers:

- **Edit files** on any remote server with Monaco Editor (the engine behind VS Code) --- full syntax highlighting for 50+ languages, bracket matching, find & replace, minimap
- **Open SSH terminals** directly in the browser alongside your editor, with multiple tabs
- **Browse filesystems** across all your servers simultaneously in a unified tree sidebar
- **Copy files between servers** --- drag content from an SFTP server to an S3 bucket, or from FTP to SFTP. Any combination works
- **Upload and download** files with drag & drop and a real-time transfer activity panel
- **Manage connections** to SFTP/SSH, FTP, FTPS, and S3-compatible storage (AWS, Wasabi, MinIO, Backblaze B2)

All from a single browser tab.

---

## Screenshots

> *CodeFromHere running on localhost:3000 --- dark theme, multi-server tree, Monaco editor, integrated terminal*

```
+------------------------------------------------------------------+
| CodeFromHere                          [bell] [settings] [logout] |
+----------+-------------------------------------------------------+
| SERVERS  | [tab: config.py] [tab: deploy.sh]                     |
|          |                                                       |
| > Prod   |  1  #!/usr/bin/env python3                            |
|   > /etc |  2  import os                                         |
|   > /var |  3  from flask import Flask                            |
| > Staging|  4                                                    |
|   > /app |  5  app = Flask(__name__)                              |
| > S3 Bkt |  6  app.config['DEBUG'] = False                       |
|          |-------------------------------------------------------|
|          | Terminal: prod-server                                  |
|          | palmera@prod:~$ systemctl status nginx                 |
|          | Active: active (running)                               |
+----------+-------------------------------------------------------+
```

---

## Tech Stack

CodeFromHere is built entirely in JavaScript --- one language for everything. No TypeScript, no build tools, no webpack, no Docker required.

### Backend

| Package | Version | Role |
|---------|---------|------|
| **[Fastify](https://fastify.dev)** | ^4 | HTTP server --- chosen over Express for its speed, native JSON schema support, and plugin architecture. Serves both the API and static frontend on a single port. |
| **[@fastify/websocket](https://github.com/fastify/fastify-websocket)** | ^8 | WebSocket support on the same HTTP port. Powers the SSH terminal bridge without requiring a separate WebSocket server. |
| **[@fastify/static](https://github.com/fastify/fastify-static)** | ^7 | Serves the frontend files. No nginx or reverse proxy needed for development. |
| **[@fastify/session](https://github.com/fastify/session)** | ^10 | Server-side session management with secure httpOnly cookies. |
| **[@fastify/multipart](https://github.com/fastify/fastify-multipart)** | ^8 | Handles file uploads up to 100MB. |
| **[@fastify/cookie](https://github.com/fastify/fastify-cookie)** | ^9 | Cookie parsing for session management. |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | ^12 | Synchronous SQLite driver. Zero-config, no external database server. The entire application state lives in a single `data/cubiq.db` file. |
| **[ssh2](https://github.com/mscdex/ssh2)** | ^1 | Pure JavaScript SSH2 client. Powers both the terminal bridge and SFTP file operations. No system `ssh` binary required. |
| **[ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)** | ^10 | High-level SFTP wrapper over ssh2 for file operations (list, read, write, mkdir, rename, delete, chmod). |
| **[basic-ftp](https://github.com/patrickjuchli/basic-ftp)** | ^5 | FTP and FTPS (FTP over TLS) client. Supports passive mode, directory listing, upload, download. |
| **[@aws-sdk/client-s3](https://github.com/aws/aws-sdk-js-v3)** | ^3 | S3 client for AWS and S3-compatible storage (Wasabi, MinIO, Backblaze B2). |
| **[@aws-sdk/lib-storage](https://github.com/aws/aws-sdk-js-v3)** | ^3 | Multipart upload support for large files to S3. |
| **[bcryptjs](https://github.com/dcodeIO/bcrypt.js)** | ^2 | Password hashing. Pure JavaScript, no native compilation. |
| **[nanoid](https://github.com/ai/nanoid)** | ^5 | Generates cryptographically secure unique IDs for terminal session tokens. |
| **[dotenv](https://github.com/motdotla/dotenv)** | ^16 | Loads configuration from `.env` files. |

### Frontend (all loaded via CDN --- zero build step)

| Library | Role |
|---------|------|
| **[Monaco Editor](https://microsoft.github.io/monaco-editor/)** 0.45.0 | The same editor engine that powers VS Code. Provides syntax highlighting, IntelliSense-like autocompletion, bracket matching, multi-cursor editing, find & replace, and language-aware formatting for 50+ languages. |
| **[xterm.js](https://xtermjs.org)** 5.3.0 | Terminal emulator for the browser. Renders a real terminal with full ANSI/VT100 support, colors, cursor positioning. Connected to remote servers via WebSocket. |
| **[Alpine.js](https://alpinejs.dev)** 3.x | Lightweight reactive framework (15KB). Handles all UI state --- tree sidebar, tabs, context menus, modals, notifications --- without a build step. Think of it as "jQuery for the reactive era." |
| **[Tailwind CSS](https://tailwindcss.com)** 3.x (Play CDN) | Utility-first CSS framework. The entire UI is styled with Tailwind classes directly in HTML. Dark theme using gray-900/950 palette with purple accents. |

### Why These Choices?

- **Single language**: JavaScript everywhere. Backend logic, file operations, SSH bridging, and the entire frontend --- all in one language. No context switching.
- **Single process, single port**: Fastify serves HTTP, WebSocket, and static files on port 3000. No nginx, no separate WebSocket server, no Docker compose.
- **Zero build tools**: The frontend loads Monaco, xterm, Alpine, and Tailwind directly from CDN. Edit an HTML file, refresh the browser. That's it.
- **SQLite over Postgres/MySQL**: One file, zero configuration, zero maintenance. Perfect for a self-hosted tool. Backups are just copying `data/cubiq.db`.
- **ssh2 over system SSH**: Pure JavaScript SSH means no dependency on system binaries. Works on any OS with Node.js. No `ssh`, `scp`, or `sftp` commands needed.

---

## Installation

### Prerequisites

- **Node.js >= 20 LTS** (tested on 20, 22, and 24)
- That's it. No Docker, no database server, no Redis, no build tools.

### Quick Start

```bash
git clone https://github.com/palmereta/CodeFromHere.git
cd CodeFromHere
npm install
cp .env.example .env
# Edit .env and set your ENCRYPTION_KEY (min 32 characters)
node server.js
```

Open `http://localhost:3000` in your browser.

**Default admin account**: A secure random password is generated on first run and printed to the console. Save it --- it won't be shown again. Change it in Settings after your first login.

### Configuration

Edit `.env`:

```ini
# REQUIRED: Encryption key for stored credentials (min 32 chars)
# Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_random_32_char_string_here

# Session secret (auto-generated if not set, but set it for persistence across restarts)
SESSION_SECRET=another_random_string_here

# Server
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Optional: Enable HSTS header (set to 1 if behind HTTPS)
ENABLE_HSTS=0
```

### Running in Production

```bash
# With PM2
pm2 start server.js --name codefromhere

# With systemd
# Create /etc/systemd/system/codefromhere.service
# ExecStart=/usr/bin/node /opt/codefromhere/server.js
# Then: systemctl enable --now codefromhere

# Or just
nohup node server.js > /var/log/codefromhere.log 2>&1 &
```

### Behind a Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name ide.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/ide.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ide.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `proxy_set_header Upgrade` and `Connection "upgrade"` lines are critical --- they enable WebSocket passthrough for the SSH terminal.

---

## How It Works

### Architecture Overview

```
Browser                          Server (Node.js)
+------------------+             +----------------------------+
|  Alpine.js App   |  HTTP/REST  |  Fastify                   |
|  Monaco Editor   | <---------> |  ├── /api/auth             |
|  xterm.js        |             |  ├── /api/connections      |
|                  |  WebSocket  |  ├── /api/files            |
|  Terminal <------+-----------> |  ├── /api/terminal         |
|                  |             |  └── /ws/terminal (WS)     |
+------------------+             +------|--------|------------+
                                        |        |
                                 +------v-+  +---v----------+
                                 | SQLite |  | SSH/FTP/S3   |
                                 | cubiq  |  | Adapters     |
                                 | .db    |  |              |
                                 +--------+  | SFTP ←→ ssh2 |
                                             | FTP  ←→ basic-ftp
                                             | S3   ←→ aws-sdk
                                             +--------------+
```

### The Filesystem Adapter Pattern

All remote connections --- regardless of protocol --- expose the same interface:

```javascript
interface FilesystemAdapter {
  connect()
  disconnect()
  list(path)          // → [{ name, path, isDir, size, modified }]
  read(path)          // → Buffer
  write(path, data)   // Buffer → remote file
  delete(path, isDir)
  mkdir(path)
  rename(old, new)
}
```

This is why cross-protocol copy works. To copy a file from SFTP to S3:

```
1. SftpAdapter.read('/var/log/app.log')  →  Buffer
2. S3Adapter.write('/logs/app.log', buffer)  →  done
```

The `POST /api/files/copy` endpoint opens two adapters simultaneously (one for source, one for destination) and pipes data between them. For directories, it recursively walks the source tree, creates directories on the destination, and copies each file.

### The SSH Terminal Bridge

The terminal is not a simulated shell --- it's a real SSH connection:

```
Browser (xterm.js)  ←WebSocket→  Server (sshBridge.js)  ←SSH→  Remote Server
     ↑ keyboard                       ↑ bridge                    ↑ real shell
     ↓ display                        ↓ relay                     ↓ bash/zsh
```

1. Frontend requests a one-time token via `POST /api/terminal/token`
2. Opens a WebSocket to `/ws/terminal?token=xxx`
3. Server validates the token (single-use, expires in 1 hour)
4. Server opens an SSH connection to the remote server using `ssh2`
5. Server requests a PTY shell (`sshClient.shell()`)
6. Bidirectional relay: keystrokes from xterm.js go to SSH stream, SSH output goes to xterm.js
7. Resize events from the browser are forwarded as PTY window changes
8. Idle sessions auto-close after 30 minutes

### Per-User SSH Keys

Each user gets an **Ed25519 SSH key pair** generated automatically at registration:

```
+-------------------+
| User Account      |
| ┌───────────────┐ |          +-------------------+
| │ Public Key    │ | -------> | ~/.ssh/            |
| │ ssh-ed25519   │ |  copy    | authorized_keys    |
| │ AAAA...       │ |  to      | on remote servers  |
| └───────────────┘ |          +-------------------+
| ┌───────────────┐ |
| │ Private Key   │ |  auto-used when connecting
| │ (encrypted    │ |  via SFTP/SSH if no explicit
| │  AES-256-GCM) │ |  credentials are set
| └───────────────┘ |
+-------------------+
```

- View your public key on the Connections page
- Copy it to `~/.ssh/authorized_keys` on your servers
- Create SFTP connections with just hostname + username --- the key is used automatically
- Each user has their own key. No shared credentials between accounts.
- Keys can be regenerated from Settings at any time.

---

## Database

CodeFromHere uses **SQLite** via `better-sqlite3`. The entire database is a single file at `data/cubiq.db`, auto-created on first run.

### Schema

```
+------------------+     +--------------------+     +------------------+
|     users        |     |   connections      |     |    ssh_keys      |
+------------------+     +--------------------+     +------------------+
| id (PK)          |──┐  | id (PK)            |  ┌──| id (PK)          |
| username (UNIQUE) |  │  | user_id (FK)  ─────┘  │  | user_id (FK) ───┘
| email (UNIQUE)    |  │  | name               |     | name             |
| password (bcrypt) |  │  | type (sftp/ftp/s3)  |     | private_key (enc)|
| created_at        |  │  | host, port          |     | public_key       |
| updated_at        |  │  | username            |     | created_at       |
+------------------+  │  | password (encrypted) |     +------------------+
                      │  | private_key (enc)    |
                      │  | root_path            |     +------------------+
                      │  | bucket, region       |     | terminal_tokens  |
                      │  | access_key (enc)     |     +------------------+
                      │  | secret_key (enc)     |     | token (PK)       |
                      │  | color, sort_order    |     | user_id          |
                      │  | created_at           |     | connection_id    |
                      │  +--------------------+     | initial_path     |
                      │                              | used (0/1)       |
                      │  +--------------------+     | expires_at       |
                      └──| audit_log           |     +------------------+
                         +--------------------+
                         | id (PK)            |
                         | user_id            |
                         | connection_id      |
                         | action             |
                         | path               |
                         | ip                 |
                         | created_at         |
                         +--------------------+
```

### Key Design Decisions

- **User isolation**: Every connection belongs to a user (`user_id` FK). All queries filter by user. There is no way for one user to see or access another user's connections.
- **Encrypted credentials**: Passwords, private keys, access keys, and secret keys are encrypted with **AES-256-GCM** before storage. The encryption key lives in `.env`, not in the database.
- **WAL mode**: SQLite runs in Write-Ahead Logging mode for concurrent read performance.
- **Audit trail**: Every sensitive operation (login, file write, file delete, SSH connection, connection creation) is logged with user ID, action, path, and IP address.

### Backup

```bash
# Just copy the file
cp data/cubiq.db data/cubiq.db.backup

# Or use SQLite's online backup
sqlite3 data/cubiq.db ".backup data/cubiq.db.backup"
```

---

## Security

CodeFromHere was designed with the assumption that it will be exposed to the internet behind HTTPS.

| Layer | Protection |
|-------|-----------|
| **Authentication** | bcrypt password hashing (cost 12), login rate limiting (5 attempts/IP/15min), session fixation protection (session ID regenerated after login) |
| **Sessions** | httpOnly cookies, sameSite=lax, configurable secure flag, 7-day expiry |
| **Credentials** | AES-256-GCM encryption at rest, encryption key in `.env` (not in DB), credentials never returned in API GET responses |
| **SSH Keys** | Per-user Ed25519 key pairs, private keys encrypted in DB, automatic key injection for connections |
| **HTTP Headers** | Content-Security-Policy, X-Content-Type-Options: nosniff, X-Frame-Options: DENY, X-XSS-Protection, Referrer-Policy, Permissions-Policy |
| **CORS** | Same-origin enforcement on all API routes |
| **Path Traversal** | All file paths sanitized (reject `..`, `.`, null bytes), validated before every operation |
| **Terminal** | Single-use tokens with 1-hour expiry, max 5 concurrent SSH sessions per user, 30-minute idle timeout |
| **Rate Limiting** | Login: 5/IP/15min, terminal tokens: 10/user/min |
| **Audit** | All sensitive operations logged to `audit_log` table with user, action, path, and IP |
| **Input Validation** | Username (alphanumeric, 3-32 chars), email format, password (min 8 chars), connection type whitelist, host format validation, port range (1-65535) |
| **User Enumeration** | Login returns the same error for wrong username and wrong password, with constant-time comparison |

### Recommendations for Production

1. **Always use HTTPS** --- run behind nginx/Caddy with Let's Encrypt, and set `ENABLE_HSTS=1`
2. **Change the default admin password** immediately after first login
3. **Use a strong `ENCRYPTION_KEY`** --- generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. **Restrict network access** --- bind to `127.0.0.1` if only accessing via reverse proxy
5. **Back up `data/cubiq.db` and `.env`** regularly --- they contain everything

---

## Project Structure

```
CodeFromHere/
├── server.js                       # Entry point: Fastify setup, plugins, routes, security headers
├── package.json                    # Dependencies (15 packages, no devDependencies)
├── .env.example                    # Configuration template
├── .gitignore
│
├── data/
│   └── cubiq.db                    # SQLite database (auto-created on first run)
│
├── src/
│   ├── db/
│   │   ├── database.js             # Database initialization, migrations, admin seed
│   │   └── schema.sql              # Complete DDL (5 tables)
│   │
│   ├── middleware/
│   │   └── auth.js                 # Session verification, login rate limiting, audit logger
│   │
│   ├── routes/
│   │   ├── auth.js                 # Login, logout, register, password change
│   │   ├── connections.js          # CRUD for server connections (encrypted storage)
│   │   ├── files.js                # File operations: list, read, write, delete, copy, upload
│   │   ├── terminal.js             # Terminal token generation
│   │   └── settings.js             # User profile, SSH key management
│   │
│   ├── services/
│   │   ├── filesystem.js           # Protocol adapters: SftpAdapter, FtpAdapter, S3Adapter
│   │   ├── crypto.js               # AES-256-GCM encrypt/decrypt for credentials
│   │   └── sshKeygen.js            # Ed25519 SSH key pair generation
│   │
│   └── ws/
│       └── sshBridge.js            # WebSocket ↔ SSH relay for terminal sessions
│
└── public/                          # Frontend (served as static files by Fastify)
    ├── index.html                   # Main IDE page (Monaco + xterm + Alpine.js)
    ├── login.html                   # Login page
    ├── connections.html             # Connection management page
    ├── css/
    │   └── ide.css                  # Custom styles (scrollbars, buttons, tree)
    └── js/
        ├── app.js                   # Alpine.js application (tree, editor, terminal, clipboard)
        ├── api.js                   # Fetch wrapper with auth redirect
        ├── editor.js                # Monaco editor utilities
        ├── terminal.js              # xterm.js theme configuration
        ├── fileTree.js              # File tree icon/size utilities
        └── contextMenu.js           # Context menu positioning
```

---

## Features

### Multi-Server Tree Sidebar
All your connections appear as expandable root nodes in the sidebar. Click to expand and browse the filesystem. Folders lazy-load their contents on first expansion. Works like the old CodeAnywhere file panel, but with all servers visible at once.

### Cross-Protocol Copy & Paste
Right-click a file or folder on any server and select **Copy** or **Cut**. Then right-click a folder on *any other server* --- even a different protocol --- and select **Paste**. CodeFromHere reads from the source adapter and writes to the destination adapter. Recursive directory copy is fully supported.

### Transfer Activity Panel
The bell icon in the header shows real-time transfer activity. Every upload, copy, and move operation appears with a progress spinner, completion timestamp, duration, source/destination paths, and error details if something fails. Auto-shows when activity starts, auto-hides when everything completes.

### Monaco Editor
Full VS Code editing experience: syntax highlighting for Python, JavaScript, TypeScript, PHP, C/C++, Java, Go, Rust, Ruby, HTML, CSS, JSON, YAML, SQL, Shell, Markdown, and 40+ more languages. Bracket pair colorization, smooth scrolling, keyboard shortcuts (Ctrl+S to save, Ctrl+W to close tab).

### Integrated SSH Terminal
Real SSH sessions in your browser via xterm.js. Multiple terminal tabs, right-click any folder to "Open Terminal Here", automatic resize handling. Idle sessions close after 30 minutes to free server resources.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save current file |
| `Ctrl+W` | Close current tab |
| `Ctrl+B` | Toggle sidebar |
| `` Ctrl+` `` | Toggle terminal panel |
| `Escape` | Close context menu |

---

## API Reference

All endpoints require authentication (session cookie) unless noted.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (public) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/auth/register` | Register new user |
| PUT | `/api/auth/password` | Change password |
| GET | `/api/connections` | List user's connections |
| POST | `/api/connections` | Create connection |
| PUT | `/api/connections/:id` | Update connection |
| DELETE | `/api/connections/:id` | Delete connection |
| POST | `/api/connections/:id/test` | Test connection |
| GET | `/api/files/list` | List directory |
| GET | `/api/files/read` | Read file content |
| POST | `/api/files/write` | Write file |
| DELETE | `/api/files/delete` | Delete file/folder |
| POST | `/api/files/mkdir` | Create directory |
| POST | `/api/files/rename` | Rename file/folder |
| POST | `/api/files/copy` | Cross-host copy/move |
| POST | `/api/files/upload` | Upload files (multipart) |
| GET | `/api/files/download` | Download file |
| POST | `/api/files/chmod` | Change permissions (SFTP) |
| POST | `/api/terminal/token` | Generate terminal session token |
| GET | `/api/settings/profile` | User profile |
| GET | `/api/settings/public-key` | User's SSH public key |
| POST | `/api/settings/regenerate-key` | Regenerate SSH key pair |
| GET | `/api/settings/ssh-keys` | List SSH keys |
| WS | `/ws/terminal?token=xxx` | SSH terminal WebSocket |

---

## Contributing

CodeFromHere is open source under the MIT license. Contributions are welcome.

```bash
git clone https://github.com/palmereta/CodeFromHere.git
cd CodeFromHere
npm install
cp .env.example .env
node --watch server.js   # Development mode with auto-reload
```

---

## License

MIT

---

<p align="center">
  <em>Built with nostalgia for CodeAnywhere Legacy, and the belief that developer tools should be owned, not rented.</em>
</p>
