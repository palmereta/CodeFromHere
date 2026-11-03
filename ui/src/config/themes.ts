// Terminal + UI color schemes. Each defines the 16 ANSI colors plus the chrome.
export interface Theme {
  name: string
  type: 'dark' | 'light'
  background: string
  foreground: string
  cursor: string
  cursorAccent?: string
  selection: string
  border: string
  tabBg: string
  tabActiveBg: string
  tabFg: string
  tabActiveFg: string
  sidebarBg: string
  accent: string
  ansi: [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]
}

export const THEMES: Record<string, Theme> = {
  hyper: {
    name: 'Hyper', type: 'dark', background: '#000000', foreground: '#ffffff', cursor: '#f81ce5', selection: 'rgba(248,28,229,0.3)',
    border: '#333333', tabBg: '#000000', tabActiveBg: '#000000', tabFg: '#7f7f7f', tabActiveFg: '#ffffff', sidebarBg: '#0a0a0a', accent: '#f81ce5',
    ansi: ['#000000', '#c51e14', '#1dc121', '#c7c329', '#0a2fc4', '#c839c5', '#20c5c6', '#c7c7c7',
      '#686868', '#fd6f6b', '#67f86f', '#fffa72', '#6a76fb', '#fd7cfc', '#68fdfe', '#ffffff'],
  },
  oneDark: {
    name: 'One Dark', type: 'dark', background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selection: 'rgba(82,139,255,0.3)',
    border: '#181a1f', tabBg: '#21252b', tabActiveBg: '#282c34', tabFg: '#7f848e', tabActiveFg: '#d7dae0', sidebarBg: '#21252b', accent: '#61afef',
    ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
  },
  tokyoNight: {
    name: 'Tokyo Night', type: 'dark', background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selection: 'rgba(122,162,247,0.3)',
    border: '#101014', tabBg: '#16161e', tabActiveBg: '#1a1b26', tabFg: '#565f89', tabActiveFg: '#c0caf5', sidebarBg: '#16161e', accent: '#7aa2f7',
    ansi: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
  },
  nord: {
    name: 'Nord', type: 'dark', background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selection: 'rgba(136,192,208,0.3)',
    border: '#242933', tabBg: '#272c36', tabActiveBg: '#2e3440', tabFg: '#7b88a1', tabActiveFg: '#eceff4', sidebarBg: '#272c36', accent: '#88c0d0',
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  },
  catppuccinMocha: {
    name: 'Catppuccin Mocha', type: 'dark', background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selection: 'rgba(88,91,112,0.6)',
    border: '#11111b', tabBg: '#181825', tabActiveBg: '#1e1e2e', tabFg: '#6c7086', tabActiveFg: '#cdd6f4', sidebarBg: '#181825', accent: '#cba6f7',
    ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'],
  },
  gruvboxDark: {
    name: 'Gruvbox Dark', type: 'dark', background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selection: 'rgba(146,131,116,0.4)',
    border: '#1d2021', tabBg: '#1d2021', tabActiveBg: '#282828', tabFg: '#928374', tabActiveFg: '#fbf1c7', sidebarBg: '#1d2021', accent: '#fabd2f',
    ansi: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  },
  solarizedDark: {
    name: 'Solarized Dark', type: 'dark', background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selection: 'rgba(7,54,66,0.9)',
    border: '#00212b', tabBg: '#00212b', tabActiveBg: '#002b36', tabFg: '#586e75', tabActiveFg: '#93a1a1', sidebarBg: '#00212b', accent: '#268bd2',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  },
  githubLight: {
    name: 'GitHub Light', type: 'light', background: '#ffffff', foreground: '#24292f', cursor: '#0969da', selection: 'rgba(9,105,218,0.2)',
    border: '#d0d7de', tabBg: '#f6f8fa', tabActiveBg: '#ffffff', tabFg: '#57606a', tabActiveFg: '#24292f', sidebarBg: '#f6f8fa', accent: '#0969da',
    ansi: ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'],
  },
}
