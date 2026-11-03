import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: `npm run dev` runs the API on :3000 and Vite on :5173 with a proxy.
// changeOrigin stays false so Host/Origin match for the CSRF/WS origin checks.
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: false },
    },
  },
})
