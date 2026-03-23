// Monaco editor utilities
// La inicialización y gestión principal está en app.js
// Este archivo puede extenderse con funcionalidades adicionales del editor

window.editorUtils = {
  // Detectar lenguaje por extensión
  detectLanguage(filename) {
    const ext = filename.split('.').pop()?.toLowerCase()
    const map = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
      json: 'json', jsonc: 'json',
      html: 'html', htm: 'html',
      css: 'css', scss: 'scss', less: 'less',
      md: 'markdown', mdx: 'markdown',
      py: 'python', rb: 'ruby', php: 'php',
      java: 'java', go: 'go', rs: 'rust',
      c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
      cs: 'csharp', swift: 'swift', kt: 'kotlin',
      sql: 'sql', sh: 'shell', bash: 'shell',
      yml: 'yaml', yaml: 'yaml', xml: 'xml',
      svg: 'xml', dockerfile: 'dockerfile',
      vue: 'html', svelte: 'html',
      env: 'ini', ini: 'ini', conf: 'ini', toml: 'ini',
    }
    return map[ext] || 'plaintext'
  }
}
