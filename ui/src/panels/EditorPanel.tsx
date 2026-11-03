import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type * as Monaco from 'monaco-editor'
import { api, ApiError } from '../api'
import { loadMonaco, languageFor, defineThemes } from '../monaco'
import { useStore, withHostKey, sourceLabel } from '../store'
import { useTabState } from '../terminal/registry'
import type { Source } from '../types'

export function EditorPanel(props: IDockviewPanelProps<{ source: Source; path: string }>) {
  const ref = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const modified = useRef<number | null>(null)
  const saved = useRef<string>('')
  const [state, setState] = useState<'loading' | 'ready' | 'binary' | 'error'>('loading')
  const [error, setError] = useState('')
  const theme = useStore(s => s.theme)
  const ecfg = useStore(s => s.config.editor)
  const font = useStore(s => s.config.fontFamily)
  const patch = useTabState(s => s.patch)
  const { source, path } = props.params

  const save = async (force = false) => {
    const ed = editorRef.current
    if (!ed) return
    const content = ed.getValue()
    try {
      const r = await withHostKey(() => api.post('/api/files/write', { source, path, content, expectedModified: modified.current, force }))
      modified.current = r.modified
      saved.current = content
      patch(props.api.id, { dirty: false })
      useStore.getState().toast(`Saved ${path.split('/').pop()}`, 'success')
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        if (confirm('The file was modified on the server after you opened it.\n\nOK = overwrite it with your version\nCancel = keep editing (you can reopen it to see their changes)')) return save(true)
        return
      }
      useStore.getState().toast(`Save failed: ${e.message}`, 'error')
    }
  }

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const [monaco, file] = await Promise.all([loadMonaco(), withHostKey(() => api.get('/api/files/read', { source, path }))])
        if (disposed) return
        if (file.binary) { setState('binary'); return }
        defineThemes(monaco, useStore.getState().theme)
        const uri = monaco.Uri.parse(`cfh://${source}/${encodeURIComponent(path)}`)
        const model = monaco.editor.getModel(uri) || monaco.editor.createModel(file.content, languageFor(monaco, path), uri)
        const ed = monaco.editor.create(ref.current!, {
          model, automaticLayout: true, fontFamily: useStore.getState().config.fontFamily, fontSize: ecfg.fontSize,
          minimap: { enabled: ecfg.minimap }, wordWrap: ecfg.wordWrap, tabSize: ecfg.tabSize, scrollBeyondLastLine: false,
          renderWhitespace: 'selection', smoothScrolling: true, cursorBlinking: 'smooth',
        })
        editorRef.current = ed
        modified.current = file.modified
        saved.current = file.content
        ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save())
        ed.onDidChangeModelContent(() => patch(props.api.id, { dirty: ed.getValue() !== saved.current }))
        setState('ready')
        if (props.api.isActive) ed.focus()
      } catch (e: any) {
        setError(e.message); setState('error')
      }
    })()
    const sub = props.api.onDidActiveChange(({ isActive }) => {
      if (isActive) {
        editorRef.current?.focus()
        const dir = path.replace(/[\\/][^\\/]*$/, '') || '/'
        useStore.getState().set({ context: { source, cwd: dir } })
      }
    })
    return () => { disposed = true; sub.dispose(); const m = editorRef.current?.getModel(); editorRef.current?.dispose(); m?.dispose() }
  }, [source, path])

  useEffect(() => { loadMonaco().then(m => defineThemes(m, theme)) }, [theme])
  useEffect(() => { editorRef.current?.updateOptions({ fontSize: ecfg.fontSize, minimap: { enabled: ecfg.minimap }, wordWrap: ecfg.wordWrap, tabSize: ecfg.tabSize, fontFamily: font }) }, [ecfg, font])

  return (
    <div className="editor-panel">
      <div className="editor-bar">
        <span className="muted">{sourceLabel(source)}</span><span className="sep">›</span><span className="editor-path">{path}</span>
        <span className="spacer" />
        {state === 'ready' && <button className="btn sm" onClick={() => save()}>Save</button>}
      </div>
      {state === 'loading' && <div className="center muted">Loading…</div>}
      {state === 'binary' && <div className="center muted">Binary file — download it from the file manager.</div>}
      {state === 'error' && <div className="center error">{error}</div>}
      <div ref={ref} className="editor-host" style={{ display: state === 'ready' ? 'block' : 'none' }} />
    </div>
  )
}
