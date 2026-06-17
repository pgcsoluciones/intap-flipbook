# Intap Flip Landing

Landing page estática para `Intap Flip`, construida con `React + Vite + Tailwind CSS`.

## Requisitos

- Node.js `18` o `20`
- npm

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build
```

El resultado se genera en:

```text
dist/
```

## Verificar salida estática

```bash
npx serve dist
```

## Deploy en Cloudflare Pages

Configurar el proyecto con estos valores:

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `landing`

## Dominio

Dominio final esperado:

```text
flipbook.intaprd.com
```

En Cloudflare Pages:

1. Crear o conectar el proyecto desde el repositorio.
2. Usar `landing` como root directory.
3. Confirmar `npm run build` como comando de build.
4. Confirmar `dist` como carpeta de salida.
5. Agregar el custom domain `flipbook.intaprd.com`.

## Notas

- El CTA principal apunta a:

```text
https://studio.flip.intaprd.com/register
```

- El sitio no usa SSR.
- El output es 100% estático.
- Es compatible con Cloudflare Pages.
