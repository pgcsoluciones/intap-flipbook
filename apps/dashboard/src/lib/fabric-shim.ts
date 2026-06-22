// Puente ("shim") hacia Fabric.js cargado por CDN en index.html (window.fabric).
// Permite escribir `import { fabric } from 'fabric'` sin meter Fabric en el bundle
// ni requerir `npm install fabric` en el build de Cloudflare Pages.
// El alias de Vite ('fabric' → este archivo) está en vite.config.ts.
const fabric = (window as any).fabric
if (!fabric) {
  console.error('Fabric.js no está cargado. Verifica el <script> CDN en index.html')
} else if (fabric.Text?.prototype) {
  // Fix bug Fabric.js 5.3.0: el textBaseline por defecto es 'alphabetical' (inválido
  // según el estándar Canvas), lo que dispara un warning del navegador en cada render
  // de cada objeto de texto. El valor correcto es 'alphabetic'. Lo corregimos en el
  // prototype para que aplique a todas las instancias de texto.
  fabric.Text.prototype.textBaseline = 'alphabetic'
}
export { fabric }
