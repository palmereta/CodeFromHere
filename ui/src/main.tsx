import { createRoot } from 'react-dom/client'
import 'dockview-react/dist/styles/dockview.css'
import './styles/dockview-hyper.css'
import '@xterm/xterm/css/xterm.css'
import './styles/app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
