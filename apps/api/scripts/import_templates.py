#!/usr/bin/env python3
"""
Importa plantillas genéricas (ZIP v3) a R2 + D1.

Qué hace:
  1. Descomprime el ZIP en una carpeta temporal.
  2. Lee catalog_manifest.json y el manifest.json de cada plantilla.
  3. Sube cada imagen a R2 (bucket intap-flipbook-media) bajo:
        templates/{slug}/pages/page-00N.jpg
        templates/{slug}/thumbs/thumb-00N.jpg
        templates/{slug}/preview/preview-board.jpg
  4. Registra cada plantilla en la tabla `templates` de D1
     (cover_url = preview-board en R2, category_id vía tabla categories).
  5. Registra cada página en `template_pages` con image_url apuntando a R2.

Idempotente: re-ejecutarlo borra e reinserta las mismas plantillas (por nombre),
sin duplicar.

Términos:
  - R2: almacenamiento de objetos de Cloudflare (bucket de archivos).
  - D1: base de datos SQLite serverless de Cloudflare.
  - slug: identificador en minúsculas-con-guiones (ej. "seguridad-electronica").

Uso (desde ~/intap-flipbook/apps/api):
    python3 scripts/import_templates.py ~/Downloads/intap_flip_generic_templates_v3.zip

Opciones:
    --plan free|basic|pro     Plan requerido para todas (def. free)
    --dry-run                 No sube ni escribe; solo muestra lo que haría
    --skip-upload             Salta la subida a R2 (solo registra en D1)
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import zipfile

R2_BUCKET = "intap-flipbook-media"
R2_PUBLIC_BASE = "https://pub-b720f233e0f84125b246181d82f993da.r2.dev"
D1_DB = "intap-flipbook-db"

# Carpeta apps/api (donde vive wrangler.toml) = padre de la carpeta scripts/
API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def slugify(text: str) -> str:
    """Convierte 'Seguridad Electrónica' → 'seguridad-electronica'."""
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    norm = norm.lower().strip()
    norm = re.sub(r"[^a-z0-9]+", "-", norm)
    return norm.strip("-")


def sql_str(value) -> str:
    """Escapa un valor para SQL (comilla simple duplicada)."""
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def run(cmd, **kw):
    """Ejecuta un comando mostrando errores claros."""
    print("  $ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=API_DIR, check=True, **kw)


def find_root(extract_dir: str) -> str:
    """Devuelve la carpeta raíz real (la que contiene catalog_manifest.json)."""
    for base, _dirs, files in os.walk(extract_dir):
        if "catalog_manifest.json" in files:
            return base
    sys.exit("ERROR: no se encontró catalog_manifest.json dentro del ZIP")


def r2_put(key: str, local_path: str, dry: bool):
    """Sube un archivo a R2 con content-type JPEG."""
    if dry:
        print(f"  [dry] R2 put {R2_BUCKET}/{key}")
        return
    run([
        "npx", "wrangler", "r2", "object", "put",
        f"{R2_BUCKET}/{key}",
        f"--file={local_path}",
        "--content-type=image/jpeg",
    ])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip_path", help="Ruta al ZIP de plantillas")
    ap.add_argument("--plan", default="free", choices=["free", "basic", "pro"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-upload", action="store_true")
    args = ap.parse_args()

    zip_path = os.path.expanduser(args.zip_path)
    if not os.path.isfile(zip_path):
        sys.exit(f"ERROR: no existe el archivo {zip_path}")

    tmp = tempfile.mkdtemp(prefix="intap_tpl_")
    print(f"→ Descomprimiendo en {tmp}")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(tmp)

    root = find_root(tmp)
    catalog = json.load(open(os.path.join(root, "catalog_manifest.json")))
    templates = catalog["templates"]
    print(f"→ {len(templates)} plantillas en el catálogo\n")

    sql_parts = ["PRAGMA foreign_keys=OFF;"]

    for idx, entry in enumerate(templates):
        slug = entry["id"]
        tpl_dir = os.path.join(root, "templates", slug)
        manifest = json.load(open(os.path.join(tpl_dir, "manifest.json")))

        name = manifest["name"]
        category = manifest.get("category", entry.get("category", "Otro"))
        cat_slug = slugify(category)
        pages = manifest["pages"]
        thumbs = manifest.get("thumbs", [])
        preview = manifest.get("preview_board")

        print(f"[{idx + 1}/{len(templates)}] {name}  ({slug})")

        # ── Subida a R2 ──
        if not args.skip_upload:
            for rel in pages + thumbs + ([preview] if preview else []):
                local = os.path.join(tpl_dir, rel)
                key = f"templates/{slug}/{rel}"
                r2_put(key, local, args.dry_run)

        cover_url = (
            f"{R2_PUBLIC_BASE}/templates/{slug}/{preview}" if preview else None
        )

        # ── SQL: categoría + plantilla (idempotente por nombre) ──
        sql_parts.append(
            f"INSERT OR IGNORE INTO categories (name, slug) "
            f"VALUES ({sql_str(category)}, {sql_str(cat_slug)});"
        )
        sql_parts.append(
            f"DELETE FROM template_pages WHERE template_id IN "
            f"(SELECT id FROM templates WHERE name = {sql_str(name)});"
        )
        sql_parts.append(
            f"DELETE FROM templates WHERE name = {sql_str(name)};"
        )
        sql_parts.append(
            "INSERT INTO templates (name, category_id, plan_required, cover_url, active, sort_order) "
            f"VALUES ({sql_str(name)}, "
            f"(SELECT id FROM categories WHERE slug = {sql_str(cat_slug)}), "
            f"{sql_str(args.plan)}, {sql_str(cover_url)}, 1, {idx});"
        )

        # ── SQL: páginas → template_pages ──
        for pnum, rel in enumerate(pages, start=1):
            page_url = f"{R2_PUBLIC_BASE}/templates/{slug}/{rel}"
            sql_parts.append(
                "INSERT INTO template_pages (template_id, image_url, page_number) "
                f"VALUES ((SELECT id FROM templates WHERE name = {sql_str(name)}), "
                f"{sql_str(page_url)}, {pnum});"
            )
        print()

    sql_parts.append("PRAGMA foreign_keys=ON;")
    sql_text = "\n".join(sql_parts) + "\n"

    sql_file = os.path.join(tmp, "import_templates.sql")
    open(sql_file, "w").write(sql_text)
    print(f"→ SQL generado: {sql_file}")

    if args.dry_run:
        print("\n--- SQL (dry-run, no se ejecuta) ---\n")
        print(sql_text)
        return

    print("→ Ejecutando en D1 (remoto)…")
    run([
        "npx", "wrangler", "d1", "execute", D1_DB,
        "--remote", f"--file={sql_file}",
    ])
    print("\n✓ Listo: plantillas en R2 + D1.")


if __name__ == "__main__":
    main()
