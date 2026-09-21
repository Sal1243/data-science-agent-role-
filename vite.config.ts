import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.e2b.app', 'localhost'],
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    rollupOptions: { output: { manualChunks: { 'data-viz': ['recharts'] } } },
  },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost'] },
})
