import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      // 'fabric' apunta al shim que re-exporta window.fabric (cargado por CDN).
      // Así el bundle no incluye Fabric.js ni requiere `npm install fabric`.
      fabric: fileURLToPath(new URL('./src/lib/fabric-shim.ts', import.meta.url)),
    },
  },
})
