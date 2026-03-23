// Objects outside Alpine reactivity (Monaco, xterm, WebSocket are huge)
const _store = {
  monacoEditor: null,
  monacoModels: {},       // tabId → ITextModel
  monacoReady: false,
  monacoReadyPromise: null,
  terminals: {},          // tabId → { term, ws, observer, fitAddon }
}

function ideApp() {
  return {
    // Connections
    connections: [],

    // Tree state — flat maps, all serializable
    treeNodes: {},    // nodeKey → { expanded, loaded, loading, children: [nodeKey...] }
    treeItems: {},    // nodeKey → { name, path, isDir, isRoot, connectionId, type, color, size, modified }

    // Selection
    selectedNodeKey: null,

    // Editor tabs
    editorTabs: [],
    activeEditorTab: null,

    // Terminal
    terminalTabs: [],
    activeTerminalTab: null,
    terminalVisible: false,
    terminalHeight: 260,

    // Layout
    sidebarVisible: true,
    sidebarWidth: 280,
    showHidden: false,
    searchQuery: '',

    // Context menu
    ctxMenu: { visible: false, x: 0, y: 0, item: null, nodeKey: null },

    // Modal
    modal: { visible: false, title: '', body: '', confirm: null },

    // Notifications
    notifications: [],

    // Rename inline
    renamingKey: null,
    renameValue: '',

    // Clipboard for cross-host copy/paste
    clipboard: null,  // { connectionId, path, name, isDir, mode: 'copy'|'cut' }

    // Transfer panel
    transfers: [],
    transferPanelOpen: false,

    // ─── INIT ───────────────────────────────────────────────
    async init() {
      await this.loadConnections()
      this.initTreeRoots()
      this.initMonaco()
      this.initKeyboardShortcuts()
    },

    // ─── CONNECTIONS ────────────────────────────────────────
    async loadConnections() {
      try {
        this.connections = await api.get('/api/connections')
      } catch (e) {
        console.error('Error loading connections:', e)
      }
    },

    // ─── TREE HELPERS ───────────────────────────────────────
    nodeKey(connectionId, path) {
      return `${connectionId}::${path}`
    },

    connIdFromKey(key) {
      return parseInt(key.split('::')[0])
    },

    pathFromKey(key) {
      return key.substring(key.indexOf('::') + 2)
    },

    initTreeRoots() {
      for (const conn of this.connections) {
        const key = this.nodeKey(conn.id, 'ROOT')
        this.treeItems[key] = {
          name: conn.name,
          path: conn.root_path || '/',
          isDir: true,
          isRoot: true,
          connectionId: conn.id,
          type: conn.type,
          color: conn.color || '#6366f1',
          host: conn.host,
        }
        this.treeNodes[key] = {
          expanded: false,
          loaded: false,
          loading: false,
          children: [],
        }
      }
    },

    async toggleNode(key) {
      const node = this.treeNodes[key]
      if (!node) return

      if (node.expanded) {
        node.expanded = false
        return
      }

      node.expanded = true
      if (!node.loaded) {
        await this.loadNodeChildren(key)
      }
    },

    async loadNodeChildren(key) {
      const node = this.treeNodes[key]
      const item = this.treeItems[key]
      if (!node || !item) return

      node.loading = true
      try {
        const connId = item.connectionId
        const path = item.isRoot ? (item.path || '/') : item.path

        const children = await api.get('/api/files/list', {
          connection_id: connId,
          path
        })

        const childKeys = []
        for (const child of children) {
          const childKey = this.nodeKey(connId, child.path)
          this.treeItems[childKey] = {
            ...child,
            connectionId: connId,
          }
          if (child.isDir && !this.treeNodes[childKey]) {
            this.treeNodes[childKey] = {
              expanded: false,
              loaded: false,
              loading: false,
              children: [],
            }
          }
          childKeys.push(childKey)
        }

        node.children = childKeys
        node.loaded = true
      } catch (e) {
        this.notify(`Error: ${e.message}`, 'error')
      } finally {
        node.loading = false
      }
    },

    async refreshNode(key) {
      const node = this.treeNodes[key]
      if (!node) return
      node.loaded = false
      node.children = []
      if (node.expanded) {
        await this.loadNodeChildren(key)
      }
    },

    parentNodeKey(key) {
      const item = this.treeItems[key]
      if (!item || item.isRoot) return null
      const parentPath = item.path.substring(0, item.path.lastIndexOf('/')) || '/'
      const rootKey = this.nodeKey(item.connectionId, 'ROOT')
      const rootItem = this.treeItems[rootKey]
      if (parentPath === (rootItem?.path || '/')) return rootKey
      return this.nodeKey(item.connectionId, parentPath)
    },

    // Computed flat list for rendering the tree
    get flatVisibleTree() {
      const result = []
      const walk = (keys, depth) => {
        for (const key of keys) {
          const item = this.treeItems[key]
          const node = this.treeNodes[key]
          if (!item) continue
          if (!item.isRoot && !this.showHidden && item.name.startsWith('.')) continue
          if (this.searchQuery && !item.isRoot && !item.isDir) {
            if (!item.name.toLowerCase().includes(this.searchQuery.toLowerCase())) continue
          }
          result.push({ key, depth, item, node })
          if (node?.expanded && node.children.length) {
            walk(node.children, depth + 1)
          }
        }
      }
      const rootKeys = this.connections.map(c => this.nodeKey(c.id, 'ROOT'))
      walk(rootKeys, 0)
      return result
    },

    // ─── TREE CLICK HANDLERS ────────────────────────────────
    onTreeNodeClick(row) {
      this.selectedNodeKey = row.key
      if (row.item.isDir || row.item.isRoot) {
        this.toggleNode(row.key)
      } else {
        // Single click on file opens it
        this.openFileFromTree(row.key)
      }
    },

    // ─── EDITOR ─────────────────────────────────────────────
    initMonaco() {
      _store.monacoReadyPromise = new Promise((resolve) => {
        require.config({
          paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }
        })
        require(['vs/editor/editor.main'], () => {
          _store.monacoReady = true
          console.log('Monaco library loaded')
          resolve()
        })
      })
    },

    ensureEditorCreated() {
      if (_store.monacoEditor) return
      const container = document.getElementById('monaco-editor')
      if (!container) return

      _store.monacoEditor = monaco.editor.create(container, {
        theme: 'vs-dark',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: 'off',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        padding: { top: 8 },
      })

      _store.monacoEditor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => this.saveActiveTab()
      )
    },

    async waitForMonaco() {
      if (_store.monacoReady) return
      if (_store.monacoReadyPromise) await _store.monacoReadyPromise
    },

    async openFileFromTree(key) {
      const item = this.treeItems[key]
      if (!item || item.isDir || item.isRoot) return

      const tabId = `${item.connectionId}::${item.path}`
      const existing = this.editorTabs.find(t => t.id === tabId)
      if (existing) { this.activateEditorTab(tabId); return }

      await this.waitForMonaco()

      try {
        const res = await api.get('/api/files/read', {
          connection_id: item.connectionId,
          path: item.path
        })

        if (res.binary) {
          this.notify('Archivo binario — solo descarga disponible', 'info')
          this.downloadTreeItem(key)
          return
        }
        if (res.tooLarge) {
          this.notify(res.message || 'Archivo muy grande para el editor', 'error')
          return
        }

        this.editorTabs.push({
          id: tabId,
          path: item.path,
          name: item.name,
          label: item.name,
          language: res.language,
          connectionId: item.connectionId,
          dirty: false,
        })
        this.activeEditorTab = tabId

        await this.$nextTick()
        this.ensureEditorCreated()

        const lang = res.language || 'plaintext'
        const model = monaco.editor.createModel(res.content || '', lang)
        _store.monacoModels[tabId] = model

        model.onDidChangeContent(() => {
          const t = this.editorTabs.find(t => t.id === tabId)
          if (t && !t.dirty) t.dirty = true
        })

        _store.monacoEditor.setModel(model)
        requestAnimationFrame(() => {
          _store.monacoEditor.layout()
          _store.monacoEditor.focus()
        })
      } catch (e) {
        this.notify(`Error abriendo archivo: ${e.message}`, 'error')
        console.error('openFile error:', e)
      }
    },

    activateEditorTab(tabId) {
      this.activeEditorTab = tabId
      const model = _store.monacoModels[tabId]
      if (model && _store.monacoEditor) {
        _store.monacoEditor.setModel(model)
        requestAnimationFrame(() => {
          _store.monacoEditor.layout()
          _store.monacoEditor.focus()
        })
      }
    },

    closeEditorTab(tabId) {
      const tab = this.editorTabs.find(t => t.id === tabId)
      if (tab?.dirty) {
        if (!confirm(`Cerrar "${tab.label}" sin guardar?`)) return
      }
      const model = _store.monacoModels[tabId]
      if (model) { model.dispose(); delete _store.monacoModels[tabId] }
      this.editorTabs = this.editorTabs.filter(t => t.id !== tabId)
      if (this.activeEditorTab === tabId) {
        const next = this.editorTabs.at(-1)
        if (next) this.activateEditorTab(next.id)
        else { this.activeEditorTab = null; _store.monacoEditor?.setModel(null) }
      }
    },

    async saveActiveTab() {
      const tab = this.editorTabs.find(t => t.id === this.activeEditorTab)
      if (!tab) return
      try {
        const content = _store.monacoEditor.getValue()
        await api.post('/api/files/write', {
          connection_id: tab.connectionId,
          path: tab.path,
          content
        })
        tab.dirty = false
        this.notify(`Guardado: ${tab.label}`, 'success')
      } catch (e) { this.notify(`Error al guardar: ${e.message}`, 'error') }
    },

    // ─── TERMINAL ───────────────────────────────────────────
    async openTerminalForNode(key) {
      const item = this.treeItems[key]
      if (!item) return
      const connId = item.connectionId
      const path = item.isDir || item.isRoot ? (item.isRoot ? item.path : item.path) : item.path.substring(0, item.path.lastIndexOf('/')) || '/'
      try {
        const { token } = await api.post('/api/terminal/token', {
          connection_id: connId,
          path
        })
        await this.createTerminalTab({
          label: item.isRoot ? item.name : (path.split('/').pop() || '/'),
          ws_url: token
        })
      } catch (e) { this.notify(e.message, 'error') }
    },

    async openNewTerminal() {
      if (!this.selectedNodeKey) { this.notify('Selecciona una conexion primero', 'error'); return }
      await this.openTerminalForNode(this.selectedNodeKey)
    },

    async createTerminalTab({ label, ws_url }) {
      const tabId = `term-${Date.now()}`
      this.terminalTabs.push({ id: tabId, label })
      this.terminalVisible = true
      this.activeTerminalTab = tabId

      await this.$nextTick()

      const container = document.getElementById(`terminal-${tabId}`)
      if (!container) return

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        theme: {
          background: '#030712', foreground: '#e5e7eb', cursor: '#a78bfa', selection: '#4c1d95',
          black: '#1f2937', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
          blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#f9fafb',
        }
      })
      const fitAddon = new FitAddon.FitAddon()
      const linksAddon = new WebLinksAddon.WebLinksAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(linksAddon)
      term.open(container)
      fitAddon.fit()

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = ws_url.startsWith('ws')
        ? ws_url
        : `${proto}//${window.location.host}/ws/terminal?token=${ws_url}`

      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) { term.write(new Uint8Array(e.data)) }
        else {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'error') term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`)
            else if (msg.type === 'exit') term.write(`\r\n\x1b[33m[Conexion cerrada]\x1b[0m\r\n`)
            else if (msg.type === 'status') term.write(`\r\n\x1b[32m${msg.message}\x1b[0m\r\n`)
          } catch { term.write(e.data) }
        }
      }

      term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
      ws.onclose = () => term.write('\r\n\x1b[33m[WebSocket cerrado]\x1b[0m\r\n')

      // Throttled resize — evita flood de mensajes resize al abrir
      let resizeTimer = null
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) return
        resizeTimer = setTimeout(() => {
          resizeTimer = null
          try {
            fitAddon.fit()
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
            }
          } catch {}
        }, 150)
      })
      resizeObserver.observe(container)

      _store.terminals[tabId] = { term, ws, observer: resizeObserver, fitAddon }
    },

    activateTerminalTab(tabId) {
      this.activeTerminalTab = tabId
      this.$nextTick(() => {
        const t = _store.terminals[tabId]
        try { t?.fitAddon?.fit() } catch {}
        t?.term?.focus()
      })
    },

    closeTerminalTab(tabId) {
      const t = _store.terminals[tabId]
      if (t) {
        try { t.ws?.close() } catch {}
        try { t.term?.dispose() } catch {}
        try { t.observer?.disconnect() } catch {}
        delete _store.terminals[tabId]
      }
      this.terminalTabs = this.terminalTabs.filter(tab => tab.id !== tabId)
      if (this.activeTerminalTab === tabId) {
        this.activeTerminalTab = this.terminalTabs.at(-1)?.id || null
      }
    },

    // ─── FILE OPERATIONS (TREE-AWARE) ───────────────────────
    getSelectedDir() {
      if (!this.selectedNodeKey) return null
      const item = this.treeItems[this.selectedNodeKey]
      if (!item) return null
      if (item.isDir || item.isRoot) return { connectionId: item.connectionId, path: item.isRoot ? item.path : item.path, nodeKey: this.selectedNodeKey }
      // File selected — use parent dir
      const parentKey = this.parentNodeKey(this.selectedNodeKey)
      const parentItem = parentKey ? this.treeItems[parentKey] : null
      if (parentItem) return { connectionId: parentItem.connectionId, path: parentItem.isRoot ? parentItem.path : parentItem.path, nodeKey: parentKey }
      return null
    },

    async newFile() {
      const dir = this.getSelectedDir()
      if (!dir) { this.notify('Selecciona una carpeta primero', 'error'); return }
      const name = prompt('Nombre del archivo:')
      if (!name) return
      const path = dir.path.replace(/\/$/, '') + '/' + name
      try {
        await api.post('/api/files/write', { connection_id: dir.connectionId, path, content: '' })
        await this.refreshNode(dir.nodeKey)
        this.notify(`Archivo creado: ${name}`, 'success')
      } catch (e) { this.notify(e.message, 'error') }
    },

    async newFolder() {
      const dir = this.getSelectedDir()
      if (!dir) { this.notify('Selecciona una carpeta primero', 'error'); return }
      const name = prompt('Nombre de la carpeta:')
      if (!name) return
      const path = dir.path.replace(/\/$/, '') + '/' + name
      try {
        await api.post('/api/files/mkdir', { connection_id: dir.connectionId, path })
        await this.refreshNode(dir.nodeKey)
        this.notify(`Carpeta creada: ${name}`, 'success')
      } catch (e) { this.notify(e.message, 'error') }
    },

    async createNewFileAt(nodeKey) {
      const item = this.treeItems[nodeKey]
      if (!item) return
      const dirKey = (item.isDir || item.isRoot) ? nodeKey : this.parentNodeKey(nodeKey)
      const dirItem = this.treeItems[dirKey]
      if (!dirItem) return
      const name = prompt('Nombre del nuevo archivo:')
      if (!name) return
      const path = (dirItem.isRoot ? dirItem.path : dirItem.path).replace(/\/$/, '') + '/' + name
      try {
        await api.post('/api/files/write', { connection_id: dirItem.connectionId, path, content: '' })
        await this.refreshNode(dirKey)
        this.notify(`Archivo creado: ${name}`, 'success')
      } catch (e) { this.notify(e.message, 'error') }
    },

    async createNewFolderAt(nodeKey) {
      const item = this.treeItems[nodeKey]
      if (!item) return
      const dirKey = (item.isDir || item.isRoot) ? nodeKey : this.parentNodeKey(nodeKey)
      const dirItem = this.treeItems[dirKey]
      if (!dirItem) return
      const name = prompt('Nombre de la nueva carpeta:')
      if (!name) return
      const path = (dirItem.isRoot ? dirItem.path : dirItem.path).replace(/\/$/, '') + '/' + name
      try {
        await api.post('/api/files/mkdir', { connection_id: dirItem.connectionId, path })
        await this.refreshNode(dirKey)
        this.notify(`Carpeta creada: ${name}`, 'success')
      } catch (e) { this.notify(e.message, 'error') }
    },

    downloadTreeItem(key) {
      const item = this.treeItems[key]
      if (!item) return
      const url = `/api/files/download?connection_id=${item.connectionId}&path=${encodeURIComponent(item.path)}`
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    },

    triggerUpload(nodeKey) {
      const item = this.treeItems[nodeKey]
      if (!item) return
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = async () => {
        const files = Array.from(input.files)
        const connId = item.connectionId
        const path = item.isRoot ? (item.path || '/') : item.path
        for (const file of files) {
          const transferId = this.addTransfer({
            type: 'upload',
            sourceName: file.name,
            sourceConnId: null,
            sourcePath: 'local',
            destConnId: connId,
            destPath: path.replace(/\/$/, '') + '/' + file.name,
          })
          try {
            const formData = new FormData()
            formData.append('connection_id', connId)
            formData.append('path', path)
            formData.append('file', file)
            await fetch('/api/files/upload', { method: 'POST', body: formData })
            this.completeTransfer(transferId, 'success')
          } catch (e) {
            this.completeTransfer(transferId, 'error', e.message)
          }
        }
        await this.refreshNode(nodeKey)
      }
      input.click()
    },

    startRename(key) {
      const item = this.treeItems[key]
      if (!item || item.isRoot) return
      this.renamingKey = key
      this.renameValue = item.name
      this.$nextTick(() => {
        const input = document.querySelector('[data-rename-input]')
        input?.focus()
        input?.select()
      })
    },

    async confirmRename(key) {
      const item = this.treeItems[key]
      if (!item || !this.renameValue || this.renameValue === item.name) { this.renamingKey = null; return }
      const dir = item.path.substring(0, item.path.lastIndexOf('/')) || '/'
      const newPath = dir.replace(/\/$/, '') + '/' + this.renameValue
      try {
        await api.post('/api/files/rename', {
          connection_id: item.connectionId,
          oldPath: item.path,
          newPath
        })
        this.renamingKey = null
        const parentKey = this.parentNodeKey(key)
        if (parentKey) await this.refreshNode(parentKey)
        this.notify('Renombrado correctamente', 'success')
      } catch (e) { this.notify(e.message, 'error') }
    },

    confirmDelete(key) {
      const item = this.treeItems[key]
      if (!item || item.isRoot) return
      this.modal = {
        visible: true,
        title: `Eliminar ${item.isDir ? 'carpeta' : 'archivo'}`,
        body: `<p class="text-sm text-gray-300">Eliminar <strong>${item.name}</strong>?${item.isDir ? ' Se eliminara todo el contenido.' : ''}</p>`,
        confirm: async () => {
          try {
            await api.delete('/api/files/delete', {
              connection_id: item.connectionId,
              path: item.path,
              isDir: item.isDir
            })
            this.modal.visible = false
            const parentKey = this.parentNodeKey(key)
            if (parentKey) await this.refreshNode(parentKey)
            this.notify('Eliminado correctamente', 'success')
          } catch (e) { this.notify(e.message, 'error') }
        }
      }
    },

    showChmod(key) {
      const item = this.treeItems[key]
      if (!item) return
      const mode = prompt('Permisos (ej: 755, 644):', '644')
      if (!mode) return
      api.post('/api/files/chmod', { connection_id: item.connectionId, path: item.path, mode })
        .then(() => this.notify(`Permisos cambiados: ${mode}`, 'success'))
        .catch(e => this.notify(e.message, 'error'))
    },

    // ─── CLIPBOARD (CROSS-HOST COPY/PASTE) ──────────────────
    clipboardCopy(nodeKey) {
      const item = this.treeItems[nodeKey]
      if (!item || item.isRoot) return
      this.clipboard = { connectionId: item.connectionId, path: item.path, name: item.name, isDir: item.isDir, mode: 'copy' }
      this.notify(`Copiado: ${item.name}`, 'info')
    },

    clipboardCut(nodeKey) {
      const item = this.treeItems[nodeKey]
      if (!item || item.isRoot) return
      this.clipboard = { connectionId: item.connectionId, path: item.path, name: item.name, isDir: item.isDir, mode: 'cut' }
      this.notify(`Cortado: ${item.name}`, 'info')
    },

    async clipboardPaste(nodeKey) {
      if (!this.clipboard) { this.notify('Nada en el portapapeles', 'error'); return }
      const destItem = this.treeItems[nodeKey]
      if (!destItem) return

      // Determine destination directory
      const destDirKey = (destItem.isDir || destItem.isRoot) ? nodeKey : this.parentNodeKey(nodeKey)
      const destDir = this.treeItems[destDirKey]
      if (!destDir) return

      const destPath = (destDir.isRoot ? destDir.path : destDir.path).replace(/\/$/, '') + '/' + this.clipboard.name

      const transferId = this.addTransfer({
        type: this.clipboard.mode === 'cut' ? 'move' : 'copy',
        sourceName: this.clipboard.name,
        sourceConnId: this.clipboard.connectionId,
        sourcePath: this.clipboard.path,
        destConnId: destDir.connectionId,
        destPath,
      })

      try {
        const res = await api.post('/api/files/copy', {
          source_connection_id: this.clipboard.connectionId,
          source_path: this.clipboard.path,
          dest_connection_id: destDir.connectionId,
          dest_path: destPath,
          is_dir: this.clipboard.isDir,
          cut: this.clipboard.mode === 'cut',
        })
        this.completeTransfer(transferId, 'success')

        // Refresh destination
        await this.refreshNode(destDirKey)

        // If cut, refresh source parent and clear clipboard
        if (this.clipboard.mode === 'cut') {
          const srcKey = this.nodeKey(this.clipboard.connectionId, this.clipboard.path)
          const srcParent = this.parentNodeKey(srcKey)
          if (srcParent) await this.refreshNode(srcParent)
          this.clipboard = null
        }

        this.notify(`${res.files_copied || 1} archivo(s) ${this.clipboard?.mode === 'cut' ? 'movido(s)' : 'copiado(s)'}`, 'success')
      } catch (e) {
        this.completeTransfer(transferId, 'error', e.message)
        this.notify(`Error: ${e.message}`, 'error')
      }
    },

    // ─── TRANSFER PANEL ─────────────────────────────────────
    addTransfer({ type, sourceName, sourceConnId, sourcePath, destConnId, destPath }) {
      const id = Date.now() + '-' + Math.random().toString(36).slice(2)
      this.transfers.unshift({
        id, type, sourceName, sourceConnId, sourcePath, destConnId, destPath,
        status: 'active', startTime: Date.now(), endTime: null, error: null,
      })
      this.transferPanelOpen = true
      return id
    },

    completeTransfer(id, status, error = null) {
      const t = this.transfers.find(t => t.id === id)
      if (t) {
        t.status = status
        t.endTime = Date.now()
        if (error) t.error = error
      }
      this.transferPanelOpen = true
      // Auto-hide after 4s if no active transfers
      setTimeout(() => {
        if (!this.transfers.some(t => t.status === 'active')) {
          this.transferPanelOpen = false
        }
      }, 4000)
    },

    clearCompletedTransfers() {
      this.transfers = this.transfers.filter(t => t.status === 'active')
      if (this.transfers.length === 0) this.transferPanelOpen = false
    },

    get activeTransferCount() {
      return this.transfers.filter(t => t.status === 'active').length
    },

    // ─── CONTEXT MENU ───────────────────────────────────────
    showTreeContextMenu(event, row) {
      const menuW = 220, menuH = 380
      const x = Math.min(event.clientX, window.innerWidth - menuW)
      const y = Math.min(event.clientY, window.innerHeight - menuH)
      this.ctxMenu = { visible: true, x, y, item: row.item, nodeKey: row.key }
      this.selectedNodeKey = row.key
    },

    // ─── ICONS ──────────────────────────────────────────────
    getTreeIcon(item) {
      if (item.isRoot) {
        const icons = { sftp: '🖥️', ftp: '🌐', ftps: '🔒', s3: '☁️' }
        return icons[item.type] || '🔗'
      }
      return this.getFileIcon(item)
    },

    getFileIcon(item) {
      if (item.isDir) return '📁'
      const ext = item.name?.split('.').pop()?.toLowerCase()
      const icons = {
        js: '🟨', ts: '🔷', vue: '💚', php: '🐘', py: '🐍',
        html: '🌐', css: '🎨', scss: '🎨', json: '📋',
        md: '📝', sql: '🗃', sh: '⚙', env: '🔑',
        jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', svg: '🎭',
        zip: '📦', tar: '📦', gz: '📦',
        pdf: '📕', xml: '📄', yaml: '⚙', yml: '⚙',
        c: '🔧', cpp: '🔧', h: '🔧', java: '☕', go: '🔵', rs: '🦀', rb: '💎',
      }
      return icons[ext] || '📄'
    },

    // ─── UTILS ──────────────────────────────────────────────
    notify(message, type = 'info') {
      const id = Date.now() + Math.random()
      this.notifications.push({ id, message, type })
      setTimeout(() => { this.notifications = this.notifications.filter(n => n.id !== id) }, 4000)
    },

    formatSize(bytes) {
      if (!bytes) return ''
      if (bytes < 1024) return bytes + 'B'
      if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + 'KB'
      if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + 'MB'
      return (bytes / 1024 ** 3).toFixed(1) + 'GB'
    },

    toggleSidebar() { this.sidebarVisible = !this.sidebarVisible },
    toggleTerminalPanel() { this.terminalVisible = !this.terminalVisible },

    startSidebarResize(e) {
      const startX = e.clientX, startW = this.sidebarWidth
      const move = ev => { this.sidebarWidth = Math.max(180, Math.min(600, startW + ev.clientX - startX)) }
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    },

    startTerminalResize(e) {
      const startY = e.clientY, startH = this.terminalHeight
      const move = ev => { this.terminalHeight = Math.max(100, Math.min(800, startH + startY - ev.clientY)) }
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    },

    initKeyboardShortcuts() {
      window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
          if (e.key === 'b') { e.preventDefault(); this.toggleSidebar() }
          if (e.key === '`') { e.preventDefault(); this.toggleTerminalPanel() }
          if (e.key === 'w') { e.preventDefault(); if (this.activeEditorTab) this.closeEditorTab(this.activeEditorTab) }
        }
        if (e.key === 'Escape') {
          this.ctxMenu.visible = false
          this.renamingKey = null
        }
      })
    },
  }
}
