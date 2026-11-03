# Roadmap

## 2.0 (this branch)
- [x] New UI: Hyper-style chrome, dockview tabs + grid with drag & drop, command palette, themes, JSON config
- [x] Persistent server-side terminal sessions with exact re-attach; tmux for SSH sites
- [x] Local PTY, SSH (jump hosts, agent, host-key pinning), Telnet
- [x] VFS: local, SFTP, SCP/shell, FTP/FTPS, S3; dual-pane manager; transfer queue with resume, compare & sync
- [x] AI agents: launch profiles, per-folder system prompts + saved context, conversation history and resume, idle/OSC notifications
- [x] Security: MFA, RBAC, lockout, server-side sessions, CSP/CSRF, crypto v2, tamper-evident audit
- [x] Desktop app (Electron) for macOS, Windows, Linux; Docker image; CI/CD

## Next
- [ ] Agent history for remote SSH sites (read transcripts over SFTP)
- [ ] Broadcast input to several terminals; snippets / saved commands
- [ ] SSH port forwarding manager (local / remote / dynamic)
- [ ] Serial port connections (desktop)
- [ ] Shell integration (OSC 133 prompts, OSC 7 cwd) injected automatically
- [ ] Plugins API (themes, commands, panels) in the spirit of Hyper
- [ ] Teams: shared site folders with per-site permissions, SSO (OIDC), audit streaming
- [ ] Auto-update for the desktop app; signed/notarized builds
- [ ] Mobile-friendly layout for the web edition
