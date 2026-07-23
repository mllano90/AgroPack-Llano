#!/usr/bin/env python3
"""
Copia datos operativos de SQLite LOCAL → PRODUCCIÓN (Render API).

1. Lee backend/agropack_pruebas.db
2. Login admin en prod
3. POST /api/correcciones/import-operacional (reemplaza operación + clientes)
4. Conserva usuarios de prod (admin/Admin2026! se mantiene)

Uso:
  cd backend && source .venv/bin/activate
  python ../scripts/sync_local_to_prod.py --yes

Opciones:
  --prod-url https://agropack-api.onrender.com
  --user admin --password 'Admin2026!'
  --db ./agropack_pruebas.db
  --dry-run
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "backend" / "agropack_pruebas.db"


def http(
    method: str,
    base: str,
    path: str,
    token: str | None = None,
    form: dict | None = None,
    body: dict | None = None,
    timeout: int = 300,
):
    url = base.rstrip("/") + path
    data = None
    headers: dict[str, str] = {}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body, default=str).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"detail": raw[:2000]}


def rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    cur = conn.execute(f"SELECT * FROM {table}")
    out = []
    for r in cur.fetchall():
        d = dict(r)
        # atributos_extra / detalle_corrida pueden venir como str JSON
        for k in ("atributos_extra", "detalle_corrida"):
            if k in d and isinstance(d[k], str) and d[k]:
                try:
                    d[k] = json.loads(d[k])
                except Exception:
                    pass
        out.append(d)
    return out


def dump_local(db_path: Path) -> dict:
    if not db_path.exists():
        raise SystemExit(f"No existe BD local: {db_path}")
    conn = sqlite3.connect(str(db_path))
    try:
        tables = {
            "clientes": "clientes",
            "recepciones": "recepcion_campo",
            "desverdizado": "inventario_desverdizado",
            "empaques": "empaque",
            "inventario_final": "inventario_final",
            "inventario_campo": "inventario_campo",
            "embarques": "embarque",
            "embarque_detalles": "embarque_detalle",
            "parrillas": "parrilla",
        }
        dump: dict = {}
        print(f"✓ Leyendo {db_path}")
        for key, table in tables.items():
            try:
                dump[key] = rows(conn, table)
            except sqlite3.Error as e:
                print(f"  ⚠ {table}: {e}")
                dump[key] = []
            print(f"  · {key}: {len(dump[key])}")
        return dump
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod-url", default="https://agropack-api.onrender.com")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="Admin2026!")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--yes",
        action="store_true",
        help="Confirma sin prompt (borrará operación en prod y la reemplaza)",
    )
    ap.add_argument(
        "--save-json",
        default=str(ROOT / "scripts" / "local_snapshot_for_prod.json"),
    )
    args = ap.parse_args()

    dump = dump_local(Path(args.db))
    payload = {
        "confirm": "IMPORT_OPERACIONAL",
        "replace_clientes": True,
        **dump,
    }

    Path(args.save_json).write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8"
    )
    print(f"✓ Snapshot guardado: {args.save_json}")

    if args.dry_run:
        print("DRY-RUN: no se toca producción")
        return 0

    if not args.yes:
        print(
            "\n⚠  Esto REEMPLAZARÁ en Render: recepciones, desverdizado, empaques,\n"
            "   inventarios, embarques y clientes por los de localhost.\n"
            "   Conserva: usuarios de producción."
        )
        conf = input("Escribe SUBIR_A_RENDER para continuar: ").strip()
        if conf != "SUBIR_A_RENDER":
            print("Cancelado.")
            return 1

    base = args.prod_url.rstrip("/")
    print(f"→ Login {base} como {args.user}…")
    code, tok = http(
        "POST",
        base,
        "/api/auth/login",
        form={"username": args.user, "password": args.password},
        timeout=90,
    )
    if code != 200 or not (tok or {}).get("access_token"):
        print(f"❌ Login falló ({code}): {tok}")
        return 1
    token = tok["access_token"]
    print("✓ Login OK")

    print("→ Importando snapshot…")
    code, res = http(
        "POST",
        base,
        "/api/correcciones/import-operacional",
        token=token,
        body=payload,
        timeout=300,
    )
    if code != 200:
        print(f"❌ Import falló ({code}): {res}")
        return 1

    print("✓ Import OK")
    print(json.dumps(res, indent=2, ensure_ascii=False, default=str))

    # Verificación rápida
    code, emb = http("GET", base, "/api/embarques/", token=token, timeout=90)
    code2, rec = http("GET", base, "/api/recepcion/", token=token, timeout=90)
    code3, inv = http(
        "GET", base, "/api/correcciones/inventario/final", token=token, timeout=90
    )
    print("\n=== PROD tras sync ===")
    print(f"embarques: {len(emb) if isinstance(emb, list) else emb}")
    print(f"recepciones: {len(rec) if isinstance(rec, list) else rec}")
    print(f"inv_final: {len(inv) if isinstance(inv, list) else inv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
