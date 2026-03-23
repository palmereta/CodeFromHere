# CodeFromHere

Web IDE auto-hosteado para gestionar archivos en servidores remotos via SFTP, FTP, FTPS y S3.
Inspirado en CodeAnywhere Legacy. Un solo proceso, un solo puerto, zero config.

## Requisitos

- Node.js >= 20 LTS

## Instalacion

```bash
git clone <repo-url> codefromhere
cd codefromhere
npm install
```

## Configuracion

Copiar el archivo de ejemplo y editar los valores:

```bash
cp .env.example .env
```

Variables obligatorias en `.env`:

| Variable | Descripcion |
|----------|-------------|
| `ENCRYPTION_KEY` | Clave AES-256 para encriptar credenciales (min 32 chars) |
| `SESSION_SECRET` | Secreto para las sesiones HTTP (min 32 chars) |
| `PORT` | Puerto del servidor (default: 3000) |
| `HOST` | Host de escucha (default: 0.0.0.0) |
| `LOG_LEVEL` | Nivel de log: info, debug, warn, error |

## Uso

```bash
# Produccion
node server.js

# Desarrollo (auto-reload)
node --watch server.js

# O con npm scripts
npm start
npm run dev
```

Abrir `http://localhost:3000` en el navegador.

## Credenciales por defecto

- **Usuario:** admin
- **Password:** admin123

Cambiar el password inmediatamente en Settings.

## Funcionalidades

- **Editor de codigo** con Monaco Editor (syntax highlighting, autocompletado)
- **Terminal SSH** integrada con xterm.js (multiples tabs)
- **Explorador de archivos** con drag & drop upload
- **Soporte multi-protocolo:** SFTP/SSH, FTP, FTPS, S3 (AWS, Wasabi, MinIO)
- **Gestion de conexiones** con credenciales encriptadas (AES-256-GCM)
- **Multiples conexiones** con selector rapido
- **Context menu** con operaciones de archivo (renombrar, eliminar, chmod, descargar)
- **Keyboard shortcuts:** Ctrl+S guardar, Ctrl+B sidebar, Ctrl+` terminal, Ctrl+W cerrar tab
- **Tema oscuro** estilo VSCode

## Arquitectura

- **Backend:** Fastify (HTTP + WebSocket en un solo puerto)
- **Base de datos:** SQLite via better-sqlite3 (archivo `data/cubiq.db`)
- **Frontend:** Alpine.js + Monaco Editor + xterm.js (todo via CDN)
- **Estilos:** Tailwind CSS via CDN

## Estructura

```
codefromhere/
├── server.js                    <- entry point
├── package.json
├── .env
├── data/cubiq.db                <- SQLite (auto-creado)
├── src/
│   ├── db/
│   │   ├── database.js          <- init SQLite + seed
│   │   └── schema.sql           <- DDL completo
│   ├── routes/
│   │   ├── auth.js              <- login, logout, register
│   │   ├── connections.js       <- CRUD conexiones
│   │   ├── files.js             <- operaciones filesystem
│   │   ├── terminal.js          <- tokens de terminal
│   │   └── settings.js          <- perfil, claves SSH
│   ├── ws/
│   │   └── sshBridge.js         <- WebSocket SSH bridge
│   ├── services/
│   │   ├── filesystem.js        <- adapters SFTP/FTP/S3
│   │   └── crypto.js            <- encrypt/decrypt AES-256-GCM
│   └── middleware/
│       └── auth.js              <- verificacion de sesion
└── public/
    ├── index.html               <- IDE principal
    ├── login.html               <- pagina de login
    ├── connections.html          <- gestion de conexiones
    ├── js/
    │   ├── app.js               <- Alpine.js app principal
    │   ├── api.js               <- fetch wrapper
    │   ├── editor.js            <- Monaco utilities
    │   ├── terminal.js          <- xterm utilities
    │   ├── fileTree.js          <- file tree utilities
    │   └── contextMenu.js       <- context menu utilities
    └── css/
        └── ide.css              <- estilos custom
```

## Seguridad

- Credenciales encriptadas con AES-256-GCM en SQLite
- Sesiones HTTP-only con cookie segura
- Tokens de terminal de uso unico con expiracion de 1 hora
- Rate limiting en generacion de tokens (10/min)
- Sanitizacion de paths (prevencion de directory traversal)
- Verificacion de ownership en todas las operaciones

## Licencia

MIT
