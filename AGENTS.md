# INTAP Flipbook Agent Instructions

## Protected Production Behaviors — Explicit Approval Required

Do not alter, remove, simplify, revert, or replace any of the following production behaviors without explicit user authorization:

- Thumbnail rendering with raster images from the image bank, uploaded project media, and canvas image objects.
- Safe public read-only route `GET/HEAD /api/upload/uploads/<tenant>/<file>`.
- Route order: `/api/upload` must be mounted before `/api`.
- Undo/Redo with explicit background restoration.
- 3-second autosave delay.
- Per-page save queue and save sequence protection.
- Fabric text editing events `text:editing:entered` and `text:editing:exited`.
- Prohibition against autosaving via `text:changed`.
- `CtaActionFields` inputs with local drafts for product action fields.

Before changing any of these areas, an agent must:

1. Explain which current behavior is being protected.
2. Explain why the change is required.
3. Run the relevant regression tests described in `docs/CRITICAL_EDITOR_BEHAVIORS.md`.
4. Obtain explicit user authorization.
5. Never replace the full `EditPublication.tsx` file for a targeted fix.
