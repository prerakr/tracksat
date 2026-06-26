import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  // No proxy needed — tle.ivanstanojevic.me serves Access-Control-Allow-Origin: *
})
