import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /api requests to the backend during development
      // This avoids CORS issues and allows clean relative API paths if desired
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        // Optionally rewrite if your backend expects no /api prefix (not needed here)
        // rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
