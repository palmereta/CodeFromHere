// Context menu utilities

window.contextMenuUtils = {
  // Posicionar el menú dentro de la ventana visible
  adjustPosition(x, y, menuWidth = 220, menuHeight = 300) {
    const maxX = window.innerWidth - menuWidth
    const maxY = window.innerHeight - menuHeight
    return {
      x: Math.min(x, maxX),
      y: Math.min(y, maxY),
    }
  }
}
