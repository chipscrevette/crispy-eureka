import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // the dashboard is the site; the 3D map is a second page that stays in sync with it
    rollupOptions: { input: { main: 'index.html', carte: 'carte.html' } },
  },
})
