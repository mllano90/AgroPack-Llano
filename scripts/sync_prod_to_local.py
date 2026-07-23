#!/usr/bin/env python3
"""
Copia datos operativos de PRODUCCIÓN (Render API) → SQLite LOCAL.
NO modifica Render. Solo lee prod y escribe backend/agropack_pruebas.db.

Uso (desde la raíz del repo o backend):
  cd backend && source .venv/bin/activate
  python ../scripts/sync_prod_to_local.py

Opciones:
  --prod-url https://agropack-api.onrender.com
  --user admin --password Admin2026!
  --dry-run   solo descarga y muestra conteos
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)


def http(
    method: str,
    base: str,
    path: str,
    token: str | None = None,
    form: dict | None = None,
    body: dict | None = None,
    timeout: int = 120,
):
    url = base.rstrip("/") + path
    data = None
    headers: dict[str, str] = {}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
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
            return e.code, {"detail": raw}


def parse_date(v) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    s = str(v)[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def parse_dt(v) -> datetime | None:
    if not v:
        return None
    s = str(v).replace("Z", "")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def enum_or_none(enum_cls, val):
    if val is None or val == "":
        return None
    s = str(val)
    # "Producto.limon_amarillo" / "limon_amarillo"
    if "." in s:
        s = s.split(".")[-1]
    try:
        return enum_cls(s)
    except Exception:
        for m in enum_cls:
            if m.value == s or m.name.lower() == s.lower():
                return m
    return None


def fetch_prod(base: str, user: str, password: str) -> dict:
    code, tok = http(
        "POST",
        base,
        "/api/auth/login",
        form={"username": user, "password": password},
    )
    if code != 200 or not (tok or {}).get("access_token"):
        raise SystemExit(f"Login prod falló ({code}): {tok}")
    token = tok["access_token"]
    print(f"✓ Login prod ({user})")

    out: dict = {}
    paths = {
        "clientes": "/api/clientes/",
        "recepciones": "/api/recepcion/",
        "empaques": "/api/empaque/",
        "embarques": "/api/embarques/",
        "inv_final": "/api/correcciones/inventario/final",
        "inv_campo": "/api/correcciones/inventario/campo",
        "desverdizado": "/api/recepcion/admin/desverdizado",
        "dashboard": "/api/reports/dashboard",
    }
    for key, path in paths.items():
        code, data = http("GET", base, path, token=token)
        if code != 200:
            print(f"  ⚠ {path} → {code} {data}")
            out[key] = [] if key != "dashboard" else {}
            continue
        out[key] = data
        n = len(data) if isinstance(data, list) else "obj"
        print(f"  · {key}: {n}")
    return out


def apply_local(dump: dict, dry_run: bool = False) -> None:
    # Forzar SQLite local (no tocar prod)
    os.environ["DATABASE_URL"] = "sqlite:///./agropack_pruebas.db"
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(
        "sqlite:///./agropack_pruebas.db",
        connect_args={"check_same_thread": False},
    )
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    from app.models.inventory import (
        Cliente,
        Embarque,
        EmbarqueDetalle,
        Empaque,
        InventarioCampo,
        InventarioDesverdizado,
        InventarioFinal,
        RecepcionCampo,
        Parrilla,
    )
    from app.models.enums import Producto, TipoMercado, TipoCultivo, VariedadUva
    from app.models.user import User

    # Ensure tables
    from app.core.database import Base

    Base.metadata.create_all(bind=engine)

    if dry_run:
        print("DRY-RUN: no se escribe BD local")
        return

    db = Session()
    try:
        # Borrar operativo (conserva users)
        for model in (
            EmbarqueDetalle,
            Embarque,
            Empaque,
            InventarioFinal,
            InventarioCampo,
            InventarioDesverdizado,
            RecepcionCampo,
            Parrilla,
        ):
            n = db.query(model).delete(synchronize_session=False)
            print(f"  wipe {model.__tablename__}: {n}")
        # Clientes: reemplazar por los de prod
        n = db.query(Cliente).delete(synchronize_session=False)
        print(f"  wipe clientes: {n}")
        db.commit()

        # --- Clientes ---
        id_map_cliente: dict[int, int] = {}
        for c in dump.get("clientes") or []:
            row = Cliente(
                id=int(c["id"]),
                nombre=c.get("nombre") or "Sin nombre",
                empresa=c.get("empresa"),
                contacto=c.get("contacto"),
                email=c.get("email"),
                telefono=c.get("telefono"),
                notas=c.get("notas"),
                activo=int(c.get("activo") if c.get("activo") is not None else 1),
                fecha_creacion=parse_dt(c.get("fecha_creacion")) or datetime.utcnow(),
            )
            db.merge(row)
            id_map_cliente[int(c["id"])] = int(c["id"])
        db.commit()
        print(f"  + clientes: {len(dump.get('clientes') or [])}")

        # --- Recepciones ---
        for r in dump.get("recepciones") or []:
            prod = enum_or_none(Producto, r.get("producto")) or Producto.LIMON_AMARILLO
            merc = enum_or_none(TipoMercado, r.get("mercado"))
            row = RecepcionCampo(
                id=int(r["id"]),
                fecha=parse_date(r.get("fecha")) or date.today(),
                producto=prod,
                variedad=enum_or_none(VariedadUva, r.get("variedad")),
                cantidad_cajas_campo=int(r.get("cantidad_cajas_campo") or 0),
                cantidad_cajas_carton=int(r.get("cantidad_cajas_carton") or 0)
                if r.get("cantidad_cajas_carton") is not None
                else 0,
                tipo_cultivo_carton=enum_or_none(TipoCultivo, r.get("tipo_cultivo_carton")),
                mercado=merc,
                lote=r.get("lote"),
                cantidad_bins=int(r.get("cantidad_bins") or 0),
                fecha_corte=parse_date(r.get("fecha_corte")),
            )
            db.merge(row)
        db.commit()
        print(f"  + recepciones: {len(dump.get('recepciones') or [])}")

        # Map lote → recepcion_id
        lote_to_rec: dict[str, int] = {}
        for r in db.query(RecepcionCampo).all():
            if r.lote:
                lote_to_rec[str(r.lote).strip()] = r.id

        # --- Desverdizado (solo con bins > 0 desde admin API) ---
        # Preferir admin list; completar ids/fechas
        desv_list = dump.get("desverdizado") or []
        # dashboard may have same without ids
        for d in desv_list:
            lote = (d.get("lote") or "").strip()
            bins = int(
                d.get("cantidad_bins_disponibles")
                or d.get("cantidad_bins")
                or 0
            )
            if bins <= 0 or not lote:
                continue
            fr = parse_date(d.get("fecha_recepcion")) or date.today()
            fts = parse_date(d.get("fecha_tentativa_salida")) or fr
            rid = d.get("id")
            rec_id = lote_to_rec.get(lote)
            row = InventarioDesverdizado(
                id=int(rid) if rid is not None else None,
                producto=Producto.LIMON_AMARILLO,
                cantidad_bins=bins,
                lote=lote,
                fecha_recepcion=fr,
                fecha_tentativa_salida=fts,
                estado=d.get("estado") or "en_desverdizado",
                recepcion_id=rec_id,
            )
            if rid is not None:
                db.merge(row)
            else:
                db.add(row)
        db.commit()
        print(f"  + desverdizado: {db.query(InventarioDesverdizado).count()}")

        # --- Empaques ---
        for e in dump.get("empaques") or []:
            prod = enum_or_none(Producto, e.get("producto")) or Producto.LIMON_AMARILLO
            merc = enum_or_none(TipoMercado, e.get("mercado")) or TipoMercado.NACIONAL
            det = e.get("detalle_corrida")
            if isinstance(det, str):
                try:
                    det = json.loads(det)
                except Exception:
                    det = None
            row = Empaque(
                id=int(e["id"]),
                fecha=parse_date(e.get("fecha")) or date.today(),
                producto=prod,
                variedad=enum_or_none(VariedadUva, e.get("variedad")),
                tipo_cultivo=enum_or_none(TipoCultivo, e.get("tipo_cultivo")),
                mercado=merc,
                cantidad_cajas_campo_usadas=int(e.get("cantidad_cajas_campo_usadas") or 0),
                cantidad_cajas_carton_producidas=int(
                    e.get("cantidad_cajas_carton_producidas") or 0
                ),
                porcentaje_merma=float(e.get("porcentaje_merma") or 0),
                numero_empacador=e.get("numero_empacador") or "EMP",
                bins_desverdizado_usados=int(e.get("bins_desverdizado_usados") or 0),
                lote_desverdizado=e.get("lote_desverdizado"),
                presentacion=e.get("presentacion"),
                talla=e.get("talla"),
                calidad=e.get("calidad"),
                cantidad_producida=int(e.get("cantidad_producida") or 0),
                detalle_corrida=det,
            )
            db.merge(row)
        db.commit()
        print(f"  + empaques: {len(dump.get('empaques') or [])}")

        # --- Inventario final ---
        # Usar admin list (con id) y enriquecer con dashboard (lote/fecha si hay)
        dash_inv = (dump.get("dashboard") or {}).get("inventario_final") or []
        # index by (pres, talla, mercado)
        dash_by_key = {}
        for i in dash_inv:
            key = (
                i.get("presentacion"),
                str(i.get("talla") or ""),
                str(i.get("mercado") or "nacional"),
            )
            dash_by_key[key] = i

        for inv in dump.get("inv_final") or []:
            prod = enum_or_none(Producto, inv.get("producto")) or Producto.LIMON_AMARILLO
            merc = enum_or_none(TipoMercado, inv.get("mercado")) or TipoMercado.NACIONAL
            pres = inv.get("presentacion")
            talla = inv.get("talla")
            calidad = inv.get("calidad")
            key = (pres, str(talla or ""), str(inv.get("mercado") or "nacional"))
            dash_i = dash_by_key.get(key) or {}
            lote = dash_i.get("lote") or inv.get("lote")
            fecha_emp = dash_i.get("fecha_empaque") or inv.get("fecha_empaque")
            extra = {}
            if pres:
                extra["presentacion"] = pres
            if talla is not None and str(talla).strip() != "":
                extra["talla"] = str(talla).strip()
            if calidad:
                extra["calidad"] = calidad
            if lote:
                extra["lote"] = lote
            if fecha_emp:
                extra["fecha_empaque"] = str(fecha_emp)[:10]
            row = InventarioFinal(
                id=int(inv["id"]),
                producto=prod,
                variedad=enum_or_none(VariedadUva, inv.get("variedad")),
                tipo_cultivo=enum_or_none(TipoCultivo, inv.get("tipo_cultivo")),
                mercado=merc,
                cantidad_stock=int(inv.get("cantidad_stock") or 0),
                fecha_actualizacion=parse_dt(inv.get("fecha_actualizacion"))
                or datetime.utcnow(),
                atributos_extra=extra or None,
            )
            db.merge(row)
        db.commit()
        print(f"  + inventario_final: {len(dump.get('inv_final') or [])}")

        # --- Inventario campo (uva) ---
        for inv in dump.get("inv_campo") or []:
            row = InventarioCampo(
                id=int(inv["id"]),
                variedad=enum_or_none(VariedadUva, inv.get("variedad"))
                or list(VariedadUva)[0],
                mercado=enum_or_none(TipoMercado, inv.get("mercado"))
                or TipoMercado.NACIONAL,
                cantidad_disponible=int(inv.get("cantidad_disponible") or 0),
                fecha_actualizacion=parse_dt(inv.get("fecha_actualizacion"))
                or datetime.utcnow(),
            )
            db.merge(row)
        db.commit()
        print(f"  + inventario_campo: {len(dump.get('inv_campo') or [])}")

        # --- Embarques ---
        for emb in dump.get("embarques") or []:
            cid = emb.get("cliente_id")
            if cid is None:
                continue
            row = Embarque(
                id=int(emb["id"]),
                fecha_salida=parse_date(emb.get("fecha_salida")) or date.today(),
                cliente_id=int(cid),
                notas=emb.get("notas"),
                estado=emb.get("estado") or "en_transito",
            )
            db.merge(row)
            for det in emb.get("detalles") or []:
                drow = EmbarqueDetalle(
                    embarque_id=int(emb["id"]),
                    producto=enum_or_none(Producto, det.get("producto"))
                    or Producto.LIMON_AMARILLO,
                    variedad=enum_or_none(VariedadUva, det.get("variedad")),
                    tipo_cultivo=enum_or_none(TipoCultivo, det.get("tipo_cultivo")),
                    mercado=enum_or_none(TipoMercado, det.get("mercado"))
                    or TipoMercado.NACIONAL,
                    cantidad_cajas=int(det.get("cantidad_cajas") or 0),
                    presentacion=det.get("presentacion"),
                    talla=det.get("talla"),
                    calidad=det.get("calidad"),
                )
                db.add(drow)
        db.commit()
        print(f"  + embarques: {len(dump.get('embarques') or [])}")

        # Ensure local admin exists
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            from app.core.security import get_password_hash
            from app.models.enums import Rol

            db.add(
                User(
                    username="admin",
                    nombre_completo="Admin Local",
                    rol=Rol.ADMIN,
                    hashed_password=get_password_hash("admin123"),
                )
            )
            db.commit()
            print("  + creado admin local (admin/admin123)")
        else:
            print(f"  · users locales conservados (admin id={admin.id})")

        # Summary
        print("\n=== LOCAL tras sync ===")
        print("recepciones", db.query(RecepcionCampo).count())
        print("desverdizado", db.query(InventarioDesverdizado).count())
        print("empaques", db.query(Empaque).count())
        print("inv_final", db.query(InventarioFinal).count())
        print(
            "inv_final stock total",
            sum(int(i.cantidad_stock or 0) for i in db.query(InventarioFinal).all()),
        )
        print("clientes", db.query(Cliente).count())
        print("embarques", db.query(Embarque).count())
    finally:
        db.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod-url", default="https://agropack-api.onrender.com")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="Admin2026!")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--save-json",
        default=str(ROOT / "scripts" / "prod_snapshot_local.json"),
        help="Ruta del snapshot JSON (solo lectura de prod)",
    )
    args = ap.parse_args()

    print(f"Origen:  {args.prod_url}  (solo lectura)")
    print(f"Destino: {BACKEND / 'agropack_pruebas.db'}  (local)")
    print("")

    dump = fetch_prod(args.prod_url, args.user, args.password)
    snap = Path(args.save_json)
    snap.parent.mkdir(parents=True, exist_ok=True)
    snap.write_text(json.dumps(dump, indent=2, default=str), encoding="utf-8")
    print(f"✓ Snapshot guardado: {snap}")

    if args.dry_run:
        print("Dry-run: no se toca SQLite local")
        return 0

    print("\nEscribiendo en SQLite local…")
    apply_local(dump, dry_run=False)
    print("\n✓ Listo. Render NO fue modificado.")
    print("  Abre http://127.0.0.1:5173  login local: admin / admin123")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
