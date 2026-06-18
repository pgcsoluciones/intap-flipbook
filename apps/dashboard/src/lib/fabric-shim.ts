// Puente ("shim") hacia Fabric.js cargado por CDN en index.html (window.fabric).
// Permite escribir `import { fabric } from 'fabric'` sin meter Fabric en el bundle
// ni requerir `npm install fabric` en el build de Cloudflare Pages.
// El alias de Vite ('fabric' → este archivo) está en vite.config.ts.
const fabric = (window as any).fabric
if (!fabric) {
  console.error('Fabric.js no está cargado. Verifica el <script> CDN en index.html')
}
export { fabric }
