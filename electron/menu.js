import { Menu } from 'electron'

export function createMenu(mainWindow) {
  const send = (action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('menu:action', action)
    }
  }

  const template = [
    {
      label: 'CodeFromHere',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'Cmd+,',
          click: () => send('open-settings'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Local Terminal',
          accelerator: 'Cmd+T',
          click: () => send('new-local-terminal'),
        },
        {
          label: 'New SSH Terminal',
          accelerator: 'Cmd+Shift+T',
          click: () => send('new-ssh-terminal'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'Cmd+W',
          click: () => send('close-tab'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'Cmd+B',
          click: () => send('toggle-sidebar'),
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'Cmd+`',
          click: () => send('toggle-terminal'),
        },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'Split Vertically',
          accelerator: 'Cmd+D',
          click: () => send('split-vertical'),
        },
        {
          label: 'Split Horizontally',
          accelerator: 'Cmd+Shift+D',
          click: () => send('split-horizontal'),
        },
        { type: 'separator' },
        {
          label: 'Next Pane',
          accelerator: 'Cmd+]',
          click: () => send('next-pane'),
        },
        {
          label: 'Previous Pane',
          accelerator: 'Cmd+[',
          click: () => send('prev-pane'),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Cmd+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
