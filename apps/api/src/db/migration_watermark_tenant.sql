-- Columna que el propio tenant controla desde su perfil.
-- Valores: NULL (no eligió nada), 'show' (activa), 'hide' (oculta)
ALTER TABLE users ADD COLUMN watermark_tenant TEXT DEFAULT NULL;
