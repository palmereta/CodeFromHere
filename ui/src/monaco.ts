// Monaco loaded lazily with local workers (no CDN; CSP-friendly).
import type * as Monaco from 'monaco-editor'

let loading: Promise<typeof Monaco> | null = null

export function loadMonaco(): Promise<typeof Monaco> {
  loading ||= (async () => {
    const [monaco, editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] = await Promise.all([
      import('monaco-editor'),
      import('monaco-editor/editor/editor.worker?worker'),
      import('monaco-editor/language/json/json.worker?worker'),
      import('monaco-editor/language/css/css.worker?worker'),
      import('monaco-editor/language/html/html.worker?worker'),
      import('monaco-editor/language/typescript/ts.worker?worker'),
    ])
    ;(self as any).MonacoEnvironment = {
      getWorker(_: string, label: string) {
        if (label === 'json') return new jsonWorker.default()
        if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker.default()
        if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker.default()
        if (label === 'typescript' || label === 'javascript') return new tsWorker.default()
        return new editorWorker.default()
      },
    }
    return monaco
  })()
  return loading
}

export function languageFor(monaco: typeof Monaco, path: string): string {
  const name = path.split(/[\\/]/).pop()!.toLowerCase()
  const special: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'plaintext', '.env': 'ini', '.htaccess': 'plaintext', 'nginx.conf': 'plaintext' }
  if (special[name]) return special[name]
  if (name.startsWith('.env')) return 'ini'
  const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
  for (const l of monaco.languages.getLanguages()) {
    if (l.filenames?.some(f => f.toLowerCase() === name)) return l.id
    if (ext && l.extensions?.includes(ext)) return l.id
  }
  return 'plaintext'
}

export function defineThemes(monaco: typeof Monaco, t: { name: string; type: 'dark' | 'light'; background: string; foreground: string; selection: string; accent: string }) {
  monaco.editor.defineTheme('cfh', {
    base: t.type === 'light' ? 'vs' : 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': t.background, 'editor.foreground': t.foreground,
      'editorCursor.foreground': t.accent, 'editor.selectionBackground': toHex(t.selection),
      'editorLineNumber.foreground': t.type === 'light' ? '#999999' : '#555555',
    },
  })
  monaco.editor.setTheme('cfh')
}

function toHex(c: string) {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m) return c
  const a = Math.round((m[4] ? Number(m[4]) : 1) * 255)
  return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('') + a.toString(16).padStart(2, '0')
}
