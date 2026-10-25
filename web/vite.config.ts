import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // two pages: the map, and the dashboard that opens beside it on a second screen
    rollupOptions: { input: { main: 'index.html', dashboard: 'dashboard.html' } },
  },
})
