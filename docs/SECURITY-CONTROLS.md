# Security controls

SOC 2 is an attestation of an *organization*, not of a piece of software. What CodeFromHere can do is provide the technical controls an operator needs to pass one, and follow OWASP ASVS so the application itself is not the weak link. This page maps what is implemented, where, and what is still missing.

## Implemented

| Area | Control | SOC 2 TSC | OWASP ASVS 4.0 | Where |
|---|---|---|---|---|
| Authentication | bcrypt (cost 12) password hashes; constant-time login (dummy hash) to prevent user enumeration | CC6.1 | 2.4.1, 2.2.1 | `src/routes/auth.js` |
| | Password policy: min length (default 12), max 256, trivial passwords rejected | CC6.1 | 2.1.1, 2.1.2 | `validatePassword` |
| | TOTP multi-factor authentication (RFC 6238), secret encrypted at rest | CC6.1 | 2.8.1 | `/api/auth/mfa/*` |
| | Per-account lockout after N failures + per-IP rate limit on login | CC6.1 | 2.2.1 | `auth.js`, `@fastify/rate-limit` |
| Sessions | Server-side store (SQLite); idle (30 min) and absolute (12 h) timeouts; regenerated id after login (fixation) | CC6.1 | 3.2.1, 3.3.1, 3.3.2 | `src/security/auth.js`, `sessionStore.js` |
| | Cookies `HttpOnly`, `SameSite=Strict`, `Secure` + `__Host-` prefix behind TLS | CC6.1 | 3.4.1–3.4.4 | `server.js` |
| | Users can list and revoke their sessions; admins can sign users out; password change revokes other sessions | CC6.2 | 3.3.3 | `/api/auth/sessions` |
| Access control | Roles (`admin`, `user`); every row scoped by `user_id`; admin-only routes | CC6.1, CC6.3 | 4.1.1, 4.2.1 | `requireRole`, all routes |
| | Local shell / filesystem of the server disabled by default in web mode; admins only when enabled | CC6.1 | 4.1.3 | `ALLOW_LOCAL_SHELL` |
| Input & output | Whitelisted fields, typed validation, parameterised SQL everywhere | CC7.1 | 5.1.3, 5.3.4 | routes |
| | Shell arguments quoted (POSIX & PowerShell), tested against injection payloads | CC7.1 | 5.3.8 | `src/sessions/agents.js`, `test/agents.test.js` |
| | 5xx responses never include internal error messages | CC7.1 | 7.4.1 | `setErrorHandler` |
| Browser | CSP `script-src 'self'` with no CDNs, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`; nosniff, COOP/CORP, Referrer-Policy, Permissions-Policy, optional HSTS | CC6.6 | 14.4.x | `src/security/http.js` |
| | CSRF: custom header required on state-changing requests + Origin check; WebSockets reject foreign origins | CC6.6 | 4.2.2, 13.2.3 | `http.js` |
| Cryptography | Credentials AES-256-GCM, random 96-bit IV, key derived with scrypt; v1 values migrated | CC6.1, CC6.7 | 6.2.1, 6.2.5 | `src/security/crypto.js` |
| | Desktop: keys in the OS keychain (`safeStorage`); web: env vars / secrets manager | CC6.1 | 6.4.1 | `desktop/main.cjs`, `src/config.js` |
| Transport | SSH host keys pinned per user (TOFU); changed keys block the connection with a MITM warning | CC6.7 | 9.2.1 | `src/services/sshConnect.js` |
| | FTPS verifies certificates by default (opt-out per site for self-signed) | CC6.7 | 9.2.1 | `vfs/ftp.js` |
| Logging | Audit trail of logins, MFA, site changes, terminal open/close, file reads/writes/deletes, transfers, admin actions | CC7.2 | 7.1.1, 7.2.1 | `src/security/audit.js` |
| | Tamper-evident: each entry hashes the previous one; integrity check + JSONL export for a SIEM | CC7.2, CC7.3 | 7.3.3 | `/api/admin/audit/*` |
| | Secrets redacted from audit details and request logs | CC7.2 | 7.1.1 | `redact`, logger config |
| Desktop app | `contextIsolation`, `sandbox`, no `nodeIntegration`, minimal preload; navigation locked to the local origin; external links to the OS browser; only notification/clipboard permissions | CC6.6 | 14.x | `desktop/main.cjs` |
| | Server bound to 127.0.0.1 on a random port; one-time login token | CC6.6 | — | `desktop/main.cjs` |
| Change mgmt / supply chain | CI: tests, typecheck, `npm audit` (high+), CodeQL `security-extended`, Dependabot; Docker image with SBOM and provenance | CC8.1, CC7.1 | 14.2.1 | `.github/` |
| Data | Terminal processes never inherit the server's secrets (env scrubbed) | CC6.1 | 8.3.4 | `termEnv` |

## Known gaps (planned)

- SSO (OIDC / SAML) and SCIM provisioning.
- Shipping the audit log to an external sink in real time (syslog / HTTP); today it can be exported as JSONL.
- Per-site permissions for shared sites in teams (sites are private per user today).
- Session recording (asciicast) of terminal sessions as an opt-in compliance feature.
- Signed and notarized desktop builds (needs certificates; see the release workflow).
- Key rotation tooling for `ENCRYPTION_KEY` (the ciphertext format is versioned to allow it).

## Operator checklist (web)

1. Serve over HTTPS; set `TRUST_PROXY=1`, `SECURE_COOKIES=1`, `ENABLE_HSTS=1`.
2. Provide `ENCRYPTION_KEY` and `SESSION_SECRET` from a secrets manager, not from the data volume.
3. Change the initial admin password and enable MFA for every admin.
4. Keep `ALLOW_LOCAL_SHELL=0` unless the host is dedicated to this purpose.
5. Back up the data volume (it contains encrypted credentials and the audit log); export the audit log to your SIEM.
6. Review users and active sessions periodically (Settings → Administration).
