-- Migración: encuadre manual de la hoja de página (zoom + posición)
-- Guarda por página el reencuadre "cubrir" elegido por el usuario en el editor.
-- Formato JSON: { "zoom": number>=1, "fx": 0..1, "fy": 0..1 }
--   zoom = 1   → cubrir estándar (recorte centrado, llena el recuadro A4)
--   zoom > 1   → acercar (zoom in) recortando más
--   fx / fy    → punto focal (0.5 / 0.5 = centrado); mueve qué parte queda visible
-- NULL = sin encuadre personalizado → el editor y el viewer usan cubrir centrado.

ALTER TABLE pages ADD COLUMN cover_json TEXT;
