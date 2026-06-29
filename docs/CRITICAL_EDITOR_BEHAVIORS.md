# Critical Editor Behaviors

These mechanisms protect production editor behavior that has already been validated visually. Do not remove or alter them without explicit user approval.

| Protected area | Function / file | What it prevents | Symptom if removed | Required regression test |
| --- | --- | --- | --- | --- |
| Thumbnail image rehydration | `renderPageThumbnailSnapshot`, `normalizeFabricAssetJson`, `collectThumbnailImageUrls`, `loadFabricImageForSnapshot` in `apps/dashboard/src/pages/EditPublication.tsx` | Missing raster images in page thumbnails, including image-bank assets and uploaded images | Left page rail thumbnails show buttons/widgets but omit raster images | Add an image from the bank and an uploaded image, verify both appear on the canvas and in the left thumbnail after page switch and hard reload |
| Public read-only uploaded assets | `servePublicUpload` in `apps/api/src/routes/upload.ts` | `401` responses when Fabric loads uploaded images and canvas tainting during thumbnail rendering | Uploaded images load in the main app but fail in Fabric thumbnail snapshots | `GET /api/upload/uploads/<tenant>/<file>` returns `200`, image content type, and allowed CORS; invalid nested upload path returns `404`; POST/DELETE without JWT return `401` |
| Upload route precedence | `app.route('/api/upload', uploadRoutes)` before `app.route('/api', pageRoutes)` in `apps/api/src/index.ts` | General `/api` routing intercepting the safe public upload route | Public uploaded image URLs return auth/routing errors instead of image responses | Confirm route order in code and verify public upload GET still returns the image |
| Undo/Redo background restoration | `applyHistory`, `restoreCanvasBackground` in `apps/dashboard/src/pages/EditPublication.tsx` | Blank or malformed canvas after history restore | Undo/Redo leaves the page white, distorted, or missing the page background | Edit text, move an image, apply Undo/Redo, verify the background remains visible and aligned |
| Autosave delay | `AUTOSAVE_DELAY_MS = 3000` in `apps/dashboard/src/pages/EditPublication.tsx` | Excessive saves during interaction and focus loss | Saves happen nearly every movement or keystroke; text inputs lose focus | Move/scale/rotate, then wait; verify one save occurs after 3 seconds from the last change |
| Per-page save sequencing | `saveSeqRef`, `saveChainRef` in `apps/dashboard/src/pages/EditPublication.tsx` | Older save responses overwriting newer edits or Undo states | A recent change disappears after a stale save response completes | Make rapid edits and Undo, wait for autosave, reload, verify the latest intended state persists |
| Text edit lifecycle | `text:editing:entered`, `text:editing:exited` listeners in `apps/dashboard/src/pages/EditPublication.tsx` | Saves and thumbnail refreshes during every Fabric text keystroke | Fabric text editing loses cursor/focus or triggers stale saves | Type in Fabric text for 15 seconds, verify focus remains stable and save happens after editing exits |
| No `text:changed` autosave | Absence of `canvas.on('text:changed', ...)` in `apps/dashboard/src/pages/EditPublication.tsx` | Per-keystroke autosave and canvas rebuild during text editing | Cursor jumps, stale save races, or active canvas refresh while typing | Run guardrail script; type in Fabric text and verify no per-keystroke save behavior |
| Product action input stability | External `CtaActionFields` with `draftValue`, `draftMessage`, `commitDraft` in `apps/dashboard/src/pages/EditPublication.tsx` | Product-card action fields remounting while typing | WhatsApp phone/message, link, call, or email inputs lose focus or jump cursor | Type for 15 seconds in primary and secondary WhatsApp fields plus link/call/email, blur, wait 3 seconds, hard reload, verify values persist |

## Incident History Resolved

- Thumbnails without images: raster images from bank/uploaded media were excluded or could not be loaded safely.
- Blank canvas on Undo: history restore loaded objects without restoring the page background.
- Invasive autosave: saving during movement and per keystroke caused focus loss and stale saves.
- Cursor jumping in WhatsApp actions: product-card CTA inputs were remounted because the component was declared inside `ProductCardWidgetProps` and updated Fabric data per character.
