// File tree utilities

window.fileTreeUtils = {
  // Iconos por extensión
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
    }
    return icons[ext] || '📄'
  },

  // Formatear tamaño
  formatSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024**2) return (bytes/1024).toFixed(1) + 'KB'
    if (bytes < 1024**3) return (bytes/1024**2).toFixed(1) + 'MB'
    return (bytes/1024**3).toFixed(1) + 'GB'
  }
}
