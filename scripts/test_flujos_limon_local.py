#!/usr/bin/env python3
"""
Pruebas end-to-end de flujos limón en API LOCAL (no Render).

Uso:
  python scripts/test_flujos_limon_local.py
  python scripts/test_flujos_limon_local.py http://127.0.0.1:8001 admin admin123
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any


API = "http://127.0.0.1:8001"
USER = "admin"
PASS = "admin123"


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""
    checks: list[str] = field(default_factory=list)


RESULTS: list[Result] = []


def log(msg: str) -> None:
    print(msg, flush=True)


def req(
    method: str,
    path: str,
    token: str | None = None,
    body: dict | None = None,
    form: dict | None = None,
    query: dict | None = None,
) -> tuple[int, Any]:
    url = API.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    headers: dict[str, str] = {}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode() or "{}"
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"detail": raw}
    except Exception as e:
        return 0, {"detail": str(e)}


def check(cond: bool, msg: str, checks: list[str]) -> bool:
    if cond:
        checks.append(f"OK  {msg}")
        return True
    checks.append(f"FAIL {msg}")
    return False


def inv_map(dash: dict) -> dict[tuple, int]:
    """(pres, talla, lote, fecha) -> stock"""
    out: dict[tuple, int] = {}
    for i in dash.get("inventario_final") or []:
        key = (
            i.get("presentacion"),
            str(i.get("talla") or ""),
            str(i.get("lote") or ""),
            str(i.get("fecha_empaque") or "")[:10],
        )
        out[key] = int(i.get("cantidad_stock") or 0)
    return out


def stock_pres(dash: dict, pres: str) -> int:
    return sum(
        int(i.get("cantidad_stock") or 0)
        for i in (dash.get("inventario_final") or [])
        if i.get("presentacion") == pres
    )


def desv_bins(dash: dict, lote: str | None = None) -> int:
    total = 0
    for d in dash.get("desverdizado") or []:
        if lote and str(d.get("lote") or "") != lote:
            continue
        total += int(d.get("cantidad_bins_disponibles") or d.get("cantidad_bins") or 0)
    return total


def login() -> str:
    code, data = req(
        "POST",
        "/api/auth/login",
        form={"username": USER, "password": PASS},
    )
    if code != 200 or not data.get("access_token"):
        raise SystemExit(f"Login falló: {code} {data}")
    return data["access_token"]


def reset(token: str) -> None:
    code, data = req(
        "POST",
        "/api/correcciones/reset-operacional",
        token=token,
        body={"confirm": "RESET_OPERACIONAL"},
    )
    if code not in (200, 201):
        # fallback wipe script path message
        log(f"  reset API {code}: {data} (continúo si ya estaba limpio)")


def dash(token: str) -> dict:
    _, d = req("GET", "/api/reports/dashboard", token=token)
    return d if isinstance(d, dict) else {}


def rend(token: str) -> dict:
    _, d = req("GET", "/api/reports/rendimientos-limon", token=token)
    return d if isinstance(d, dict) else {}


def recepcion(token: str, lote: str, bins: int, fecha: str = "2026-07-01") -> dict:
    code, data = req(
        "POST",
        "/api/recepcion/",
        token=token,
        body={
            "producto": "limon_amarillo",
            "mercado": "exportacion",
            "lote": lote,
            "cantidad_bins": bins,
            "fecha_corte": fecha,
            "cantidad_cajas_campo": 0,
            "cantidad_cajas_carton": 0,
        },
    )
    if code not in (200, 201):
        raise RuntimeError(f"recepcion {lote}: {code} {data}")
    return data


def empaque_campo(
    token: str,
    *,
    fecha: str,
    consumos: list[dict],
    produccion: list[dict],
    empacador: str = "EMP-TEST",
) -> dict:
    # etiquetar lote/fecha en producción
    prod = []
    for p in produccion:
        row = dict(p)
        if not row.get("lote") and consumos:
            row["lote"] = consumos[0]["lote"]
        if not row.get("fecha_empaque"):
            row["fecha_empaque"] = fecha
        prod.append(row)
    code, data = req(
        "POST",
        "/api/empaque/",
        token=token,
        body={
            "producto": "limon_amarillo",
            "mercado": "exportacion",
            "numero_empacador": empacador,
            "fecha": fecha,
            "consumos_desverdizado": consumos,
            "produccion": prod,
            "bins_desverdizado_usados": sum(c["bins"] for c in consumos),
            "lote_desverdizado": consumos[0]["lote"] if consumos else None,
        },
    )
    if code not in (200, 201):
        raise RuntimeError(f"empaque: {code} {data}")
    return data


def convertir_granel(
    token: str,
    *,
    fecha: str,
    consumos_granel: list[dict],
    produccion: list[dict],
) -> dict:
    code, data = req(
        "POST",
        "/api/empaque/convertir-granel",
        token=token,
        body={
            "mercado": "exportacion",
            "fecha": fecha,
            "numero_empacador": "EMP-TEST",
            "consumos_granel": consumos_granel,
            "produccion": produccion,
        },
    )
    if code not in (200, 201):
        raise RuntimeError(f"convertir-granel: {code} {data}")
    return data


def anular(token: str, emp_id: int, forzar: bool = False) -> tuple[int, Any]:
    return req(
        "POST",
        f"/api/empaque/{emp_id}/anular",
        token=token,
        query={"forzar": "true"} if forzar else None,
    )


def eliminar_anulado(token: str, emp_id: int) -> tuple[int, Any]:
    return req("DELETE", f"/api/empaque/{emp_id}", token=token)


def editar_empaque(token: str, emp_id: int, body: dict) -> tuple[int, Any]:
    return req("PUT", f"/api/empaque/{emp_id}/editar", token=token, body=body)


def embarque(token: str, cliente_id: int, detalles: list[dict]) -> tuple[int, Any]:
    return req(
        "POST",
        "/api/embarques/",
        token=token,
        body={"cliente_id": cliente_id, "notas": "test", "detalles": detalles},
    )


def delete_embarque(token: str, emb_id: int) -> tuple[int, Any]:
    return req("DELETE", f"/api/correcciones/embarque/{emb_id}", token=token)


def get_clientes(token: str) -> list:
    code, data = req("GET", "/api/clientes/", token=token)
    if code == 200 and isinstance(data, list) and data:
        return data
    # create one
    code2, c = req(
        "POST",
        "/api/clientes/",
        token=token,
        body={"nombre": "Cliente Test QA", "activo": True},
    )
    if code2 in (200, 201):
        return [c]
    return []


def run() -> int:
    global API, USER, PASS
    if len(sys.argv) >= 2:
        API = sys.argv[1]
    if len(sys.argv) >= 4:
        USER, PASS = sys.argv[2], sys.argv[3]

    log(f"=== Pruebas limón LOCAL → {API} ===")
    token = login()
    log("Login OK")

    # ------------------------------------------------------------------
    # 0. Reset
    # ------------------------------------------------------------------
    checks: list[str] = []
    reset(token)
    d0 = dash(token)
    ok = True
    ok &= check(stock_pres(d0, "rpc_18") == 0, "reset: sin rpc_18", checks)
    ok &= check(stock_pres(d0, "rpc_granel") == 0, "reset: sin granel", checks)
    ok &= check(desv_bins(d0) == 0, "reset: sin desverdizado", checks)
    r0 = rend(token)
    ok &= check(len(r0.get("corridas") or []) == 0, "reset: sin corridas reporte", checks)
    RESULTS.append(Result("0. Reset operacional", ok, checks=checks))
    log(("PASS" if ok else "FAIL") + " 0. Reset")

    clientes = get_clientes(token)
    cliente_id = clientes[0]["id"] if clientes else None

    # ------------------------------------------------------------------
    # A. Recepción + empaque solo final
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        recepcion(token, "L-QA-A", 50, "2026-07-10")
        d = dash(token)
        ok &= check(desv_bins(d, "L-QA-A") == 50, "recepción A: 50 bins desverdizado", checks)

        emp_a = empaque_campo(
            token,
            fecha="2026-07-12",
            consumos=[{"lote": "L-QA-A", "bins": 20}],
            produccion=[
                {"presentacion": "rpc_18", "talla": "140", "cantidad": 100},
                {"presentacion": "rpc_18", "talla": "165", "cantidad": 100},
                {"presentacion": "caja_40lbs", "talla": "95", "cantidad": 50},
                {"presentacion": "bins_jugo", "cantidad": 1},
            ],
        )
        emp_a_id = emp_a["id"]
        d = dash(token)
        ok &= check(desv_bins(d, "L-QA-A") == 30, "empaque A: quedan 30 bins", checks)
        ok &= check(stock_pres(d, "rpc_18") == 200, "empaque A: 200 rpc_18", checks)
        ok &= check(stock_pres(d, "caja_40lbs") == 50, "empaque A: 50 cartón", checks)
        ok &= check(stock_pres(d, "bins_jugo") == 1, "empaque A: 1 jugo", checks)
        ok &= check(stock_pres(d, "rpc_granel") == 0, "empaque A: sin granel", checks)

        r = rend(token)
        corr = r.get("corridas") or []
        ok &= check(len(corr) >= 1, "reporte A: hay corrida", checks)
        c = next((x for x in corr if x["id"] == emp_a_id), corr[0] if corr else {})
        # final only: 200*18 + 50*18 = 4500; jugo 900; entrada 20*260=5200
        kg1_esp = 200 * 18 + 50 * 18
        ok &= check(
            abs(float(c.get("kg_primera") or 0) - kg1_esp) < 0.1,
            f"reporte A: kg1={c.get('kg_primera')} esperado {kg1_esp}",
            checks,
        )
        ok &= check(
            float(c.get("kg_granel") or 0) == 0,
            "reporte A: kg_granel=0",
            checks,
        )
        ok &= check(
            c.get("bins_campo") == 20,
            f"reporte A: bins={c.get('bins_campo')}",
            checks,
        )
        RESULTS.append(Result("A. Recepción + empaque solo final", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " A. Solo final")
    except Exception as e:
        RESULTS.append(Result("A. Recepción + empaque solo final", False, str(e), checks))
        log(f"FAIL A: {e}")
        emp_a_id = None

    # ------------------------------------------------------------------
    # B. Mixto final+granel + conversión + fusión reporte
    # ------------------------------------------------------------------
    checks = []
    ok = True
    emp_b_id = None
    emp_conv_id = None
    try:
        recepcion(token, "L-QA-B", 100, "2026-07-08")
        emp_b = empaque_campo(
            token,
            fecha="2026-07-15",
            consumos=[{"lote": "L-QA-B", "bins": 40}],
            produccion=[
                {"presentacion": "rpc_18", "talla": "200", "cantidad": 300},  # 5400 kg
                {"presentacion": "rpc_granel", "talla": "75", "cantidad": 50},  # 1100
                {"presentacion": "rpc_granel", "talla": "95", "cantidad": 50},  # 1100
            ],
        )
        emp_b_id = emp_b["id"]
        d = dash(token)
        ok &= check(desv_bins(d, "L-QA-B") == 60, "B campo: 60 bins restan", checks)
        ok &= check(stock_pres(d, "rpc_granel") == 100, "B campo: 100 granel stock", checks)
        # rpc_18 = 200 (A) + 300 (B) = 500
        ok &= check(stock_pres(d, "rpc_18") == 500, f"B campo: rpc_18 total {stock_pres(d,'rpc_18')}", checks)

        r = rend(token)
        c_b = next((x for x in (r.get("corridas") or []) if x["id"] == emp_b_id), None)
        ok &= check(c_b is not None, "B: corrida B en reporte", checks)
        if c_b:
            # kg1 solo final 300*18=5400, NO granel 2200
            ok &= check(
                abs(float(c_b["kg_primera"]) - 5400) < 0.1,
                f"B pre-conv: kg1={c_b['kg_primera']} (solo final 5400)",
                checks,
            )
            ok &= check(
                abs(float(c_b.get("kg_granel") or 0) - 2200) < 0.1,
                f"B pre-conv: kg_granel WIP={c_b.get('kg_granel')}",
                checks,
            )

        conv = convertir_granel(
            token,
            fecha="2026-07-16",
            consumos_granel=[
                {
                    "talla": "75",
                    "lote": "L-QA-B",
                    "fecha_empaque": "2026-07-15",
                    "cantidad": 50,
                },
                {
                    "talla": "95",
                    "lote": "L-QA-B",
                    "fecha_empaque": "2026-07-15",
                    "cantidad": 50,
                },
            ],
            produccion=[
                {"presentacion": "caja_40lbs", "talla": "75", "cantidad": 40},
                {"presentacion": "caja_40lbs", "talla": "95", "cantidad": 40},
            ],
        )
        emp_conv_id = conv.get("empaque_id")
        d = dash(token)
        ok &= check(stock_pres(d, "rpc_granel") == 0, "B conv: granel 0", checks)
        # cartón: 50 (A) + 80 (B conv) = 130
        ok &= check(
            stock_pres(d, "caja_40lbs") == 130,
            f"B conv: cartón={stock_pres(d,'caja_40lbs')} esp 130",
            checks,
        )

        r = rend(token)
        # Debe fusionar B + conv en UN proceso con id emp_b
        c_proc = next((x for x in (r.get("corridas") or []) if x["id"] == emp_b_id), None)
        ok &= check(c_proc is not None, "B post: proceso fusionado existe", checks)
        if c_proc:
            ok &= check(
                c_proc.get("tipo_corrida") == "proceso",
                f"B post: tipo={c_proc.get('tipo_corrida')}",
                checks,
            )
            # final = 5400 + 80*18 = 5400+1440 = 6840
            ok &= check(
                abs(float(c_proc["kg_primera"]) - 6840) < 0.1,
                f"B post: kg1={c_proc['kg_primera']} esp 6840 (final+conv)",
                checks,
            )
            ok &= check(
                emp_conv_id in (c_proc.get("ids_empaques") or []),
                f"B post: conv en ids {c_proc.get('ids_empaques')}",
                checks,
            )
            pasos = c_proc.get("pasos") or []
            ok &= check(len(pasos) == 2, f"B post: 2 pasos, got {len(pasos)}", checks)
            tipos = [p.get("tipo") for p in pasos]
            ok &= check(
                "campo" in tipos and "conversion_granel" in tipos,
                f"B post: pasos {tipos}",
                checks,
            )
            # No debe haber fila suelta de conversión
            sueltas = [
                x
                for x in (r.get("corridas") or [])
                if x.get("tipo_corrida") == "conversion_granel" and x["id"] == emp_conv_id
            ]
            ok &= check(len(sueltas) == 0, "B post: conv no aparece suelta", checks)

        RESULTS.append(Result("B. Mixto + conversión + fusión reporte", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " B. Mixto+conversión")
    except Exception as e:
        RESULTS.append(Result("B. Mixto + conversión + fusión reporte", False, str(e), checks))
        log(f"FAIL B: {e}")

    # ------------------------------------------------------------------
    # C. Anular conversión (revierte granel y quita final)
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        if not emp_conv_id:
            raise RuntimeError("sin emp_conv_id")
        code, an = anular(token, emp_conv_id)
        ok &= check(code == 200, f"anular conv status {code} {an}", checks)
        d = dash(token)
        ok &= check(stock_pres(d, "rpc_granel") == 100, f"C: granel devuelto={stock_pres(d,'rpc_granel')}", checks)
        ok &= check(
            stock_pres(d, "caja_40lbs") == 50,
            f"C: cartón solo A={stock_pres(d,'caja_40lbs')}",
            checks,
        )
        r = rend(token)
        c_b = next((x for x in (r.get("corridas") or []) if x["id"] == emp_b_id), None)
        if c_b:
            # Sin conversión: solo final campo 5400
            ok &= check(
                abs(float(c_b["kg_primera"]) - 5400) < 0.1,
                f"C: kg1 tras anular conv={c_b['kg_primera']} esp 5400",
                checks,
            )
            ok &= check(
                (c_b.get("tipo_corrida") or "campo") == "campo",
                f"C: tipo vuelve a campo={c_b.get('tipo_corrida')}",
                checks,
            )
        # Re-convertir para dejar estado usable
        conv2 = convertir_granel(
            token,
            fecha="2026-07-17",
            consumos_granel=[
                {
                    "talla": "75",
                    "lote": "L-QA-B",
                    "fecha_empaque": "2026-07-15",
                    "cantidad": 50,
                },
                {
                    "talla": "95",
                    "lote": "L-QA-B",
                    "fecha_empaque": "2026-07-15",
                    "cantidad": 50,
                },
            ],
            produccion=[
                {"presentacion": "caja_40lbs", "talla": "75", "cantidad": 40},
                {"presentacion": "caja_40lbs", "talla": "95", "cantidad": 40},
            ],
        )
        emp_conv_id = conv2.get("empaque_id")
        ok &= check(stock_pres(dash(token), "rpc_granel") == 0, "C: re-conv granel 0", checks)
        RESULTS.append(Result("C. Anular conversión granel→final", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " C. Anular conversión")
    except Exception as e:
        RESULTS.append(Result("C. Anular conversión granel→final", False, str(e), checks))
        log(f"FAIL C: {e}")

    # ------------------------------------------------------------------
    # D. Anular empaque de campo (solo final A) — devuelve bins y quita stock
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        if not emp_a_id:
            raise RuntimeError("sin emp_a_id")
        d_before = dash(token)
        bins_before = desv_bins(d_before, "L-QA-A")
        rpc_before = stock_pres(d_before, "rpc_18")
        code, an = anular(token, emp_a_id)
        ok &= check(code == 200, f"anular A status {code} {an}", checks)
        d = dash(token)
        ok &= check(
            desv_bins(d, "L-QA-A") == bins_before + 20,
            f"D: bins A devueltos {desv_bins(d,'L-QA-A')} esp {bins_before+20}",
            checks,
        )
        ok &= check(
            stock_pres(d, "rpc_18") == rpc_before - 200,
            f"D: rpc_18 {stock_pres(d,'rpc_18')} esp {rpc_before-200}",
            checks,
        )
        ok &= check(
            stock_pres(d, "caja_40lbs") == 80,  # solo los de conv B
            f"D: cartón={stock_pres(d,'caja_40lbs')} esp 80 (solo B)",
            checks,
        )
        r = rend(token)
        # A anulado no debe salir en corridas
        ids_r = [c["id"] for c in (r.get("corridas") or [])]
        ok &= check(emp_a_id not in ids_r, f"D: A no en reporte {ids_r}", checks)
        # B proceso sigue
        ok &= check(emp_b_id in ids_r, "D: B sigue en reporte", checks)

        # Borrar anulado del historial
        code, el = eliminar_anulado(token, emp_a_id)
        ok &= check(code == 200, f"eliminar A anulado {code} {el}", checks)
        RESULTS.append(Result("D. Anular empaque campo + borrar historial", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " D. Anular campo")
    except Exception as e:
        RESULTS.append(Result("D. Anular empaque campo + borrar historial", False, str(e), checks))
        log(f"FAIL D: {e}")

    # ------------------------------------------------------------------
    # E. Editar empaque (cambiar producción)
    # ------------------------------------------------------------------
    checks = []
    ok = True
    emp_e_id = None
    try:
        # Usar bins restantes L-QA-A (50 tras anular A)
        emp_e = empaque_campo(
            token,
            fecha="2026-07-18",
            consumos=[{"lote": "L-QA-A", "bins": 10}],
            produccion=[
                {"presentacion": "rpc_18", "talla": "140", "cantidad": 50},
            ],
        )
        emp_e_id = emp_e["id"]
        d = dash(token)
        rpc_mid = stock_pres(d, "rpc_18")
        code, ed = editar_empaque(
            token,
            emp_e_id,
            {
                "consumos": [{"lote": "L-QA-A", "bins": 10}],
                "produccion": [
                    {"presentacion": "rpc_18", "talla": "140", "cantidad": 80},
                ],
                "fecha": "2026-07-18",
            },
        )
        ok &= check(code == 200, f"editar status {code} {ed}", checks)
        d = dash(token)
        # +30 rpc_18
        ok &= check(
            stock_pres(d, "rpc_18") == rpc_mid + 30,
            f"E: rpc tras edit {stock_pres(d,'rpc_18')} esp {rpc_mid+30}",
            checks,
        )
        r = rend(token)
        c_e = next((x for x in (r.get("corridas") or []) if x["id"] == emp_e_id), None)
        if c_e:
            ok &= check(
                abs(float(c_e["kg_primera"]) - 80 * 18) < 0.1,
                f"E: kg1={c_e['kg_primera']} esp {80*18}",
                checks,
            )
        RESULTS.append(Result("E. Editar empaque (ajustes inventario)", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " E. Editar")
    except Exception as e:
        RESULTS.append(Result("E. Editar empaque (ajustes inventario)", False, str(e), checks))
        log(f"FAIL E: {e}")

    # ------------------------------------------------------------------
    # F. Embarque + anular embarque (devolver stock)
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        if not cliente_id:
            raise RuntimeError("sin cliente")
        d_before = dash(token)
        rpc_before = stock_pres(d_before, "rpc_18")
        code, emb = embarque(
            token,
            cliente_id,
            [
                {
                    "producto": "limon_amarillo",
                    "mercado": "exportacion",
                    "presentacion": "rpc_18",
                    "talla": "200",
                    "calidad": "primera",
                    "cantidad_cajas": 50,
                }
            ],
        )
        ok &= check(code in (200, 201), f"embarque {code} {emb}", checks)
        emb_id = emb.get("id") if isinstance(emb, dict) else None
        d = dash(token)
        ok &= check(
            stock_pres(d, "rpc_18") == rpc_before - 50,
            f"F: stock tras embarque {stock_pres(d,'rpc_18')} esp {rpc_before-50}",
            checks,
        )
        if emb_id:
            code, de = delete_embarque(token, emb_id)
            ok &= check(code == 200, f"borrar embarque {code} {de}", checks)
            d = dash(token)
            ok &= check(
                stock_pres(d, "rpc_18") == rpc_before,
                f"F: stock restaurado {stock_pres(d,'rpc_18')} esp {rpc_before}",
                checks,
            )
        RESULTS.append(Result("F. Embarque + corrección (devolver stock)", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " F. Embarque")
    except Exception as e:
        RESULTS.append(Result("F. Embarque + corrección (devolver stock)", False, str(e), checks))
        log(f"FAIL F: {e}")

    # ------------------------------------------------------------------
    # G. Anular empaque de campo que aún tiene granel sin convertir
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        recepcion(token, "L-QA-G", 30, "2026-07-20")
        emp_g = empaque_campo(
            token,
            fecha="2026-07-21",
            consumos=[{"lote": "L-QA-G", "bins": 15}],
            produccion=[
                {"presentacion": "rpc_granel", "talla": "115", "cantidad": 40},
                {"presentacion": "rpc_18", "talla": "165", "cantidad": 20},
            ],
        )
        gid = emp_g["id"]
        d = dash(token)
        g_before = stock_pres(d, "rpc_granel")
        rpc_before = stock_pres(d, "rpc_18")
        bins_before = desv_bins(d, "L-QA-G")
        code, an = anular(token, gid)
        ok &= check(code == 200, f"anular G {code} {an}", checks)
        d = dash(token)
        ok &= check(
            desv_bins(d, "L-QA-G") == bins_before + 15,
            f"G: bins devueltos {desv_bins(d,'L-QA-G')}",
            checks,
        )
        ok &= check(
            stock_pres(d, "rpc_granel") == g_before - 40,
            f"G: granel restado {stock_pres(d,'rpc_granel')} esp {g_before-40}",
            checks,
        )
        ok &= check(
            stock_pres(d, "rpc_18") == rpc_before - 20,
            f"G: rpc restado {stock_pres(d,'rpc_18')}",
            checks,
        )
        RESULTS.append(Result("G. Anular campo con granel WIP", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " G. Anular con granel")
    except Exception as e:
        RESULTS.append(Result("G. Anular campo con granel WIP", False, str(e), checks))
        log(f"FAIL G: {e}")

    # ------------------------------------------------------------------
    # H. Bloqueo anular si stock final ya no alcanza (embarque) + forzar
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        if not cliente_id:
            raise RuntimeError("sin cliente")
        # Talla única en toda la suite para no mezclar stock de otras corridas
        talla_h = "250"
        recepcion(token, "L-QA-H", 20, "2026-07-22")
        emp_h = empaque_campo(
            token,
            fecha="2026-07-22",
            consumos=[{"lote": "L-QA-H", "bins": 10}],
            produccion=[{"presentacion": "rpc_18", "talla": talla_h, "cantidad": 45}],
        )
        hid = emp_h["id"]
        d = dash(token)
        stock_h = sum(
            int(i.get("cantidad_stock") or 0)
            for i in (d.get("inventario_final") or [])
            if i.get("presentacion") == "rpc_18" and str(i.get("talla")) == talla_h
        )
        ok &= check(stock_h == 45, f"H: stock talla {talla_h}={stock_h}", checks)
        code, emb = embarque(
            token,
            cliente_id,
            [
                {
                    "producto": "limon_amarillo",
                    "mercado": "exportacion",
                    "presentacion": "rpc_18",
                    "talla": talla_h,
                    "calidad": "primera",
                    "cantidad_cajas": 45,
                }
            ],
        )
        ok &= check(code in (200, 201), f"H embarque {code} {emb}", checks)
        d = dash(token)
        stock_h2 = sum(
            int(i.get("cantidad_stock") or 0)
            for i in (d.get("inventario_final") or [])
            if i.get("presentacion") == "rpc_18" and str(i.get("talla")) == talla_h
        )
        ok &= check(stock_h2 == 0, f"H: stock talla {talla_h} tras embarque={stock_h2}", checks)
        code, an = anular(token, hid, forzar=False)
        ok &= check(code == 409, f"H: anular bloqueado 409 got {code} {an}", checks)
        code, an2 = anular(token, hid, forzar=True)
        ok &= check(code == 200, f"H: anular forzado {code} {an2}", checks)
        d = dash(token)
        ok &= check(
            desv_bins(d, "L-QA-H") == 20,
            f"H: bins devueltos a 20, got {desv_bins(d,'L-QA-H')}",
            checks,
        )
        # Con forzar, bins vuelven aunque final no se pudo restar (ya embarcado)
        if isinstance(an2, dict):
            ok &= check(
                an2.get("stock_final_revertido") is False or an2.get("forzado") is True
                or an2.get("aviso"),
                f"H: aviso forzado presente {an2}",
                checks,
            )
        RESULTS.append(Result("H. Anular bloqueado post-embarque + forzar", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " H. Anular 409/forzar")
    except Exception as e:
        RESULTS.append(Result("H. Anular bloqueado post-embarque + forzar", False, str(e), checks))
        log(f"FAIL H: {e}")

    # ------------------------------------------------------------------
    # I. Multi-lote en un empaque
    # ------------------------------------------------------------------
    checks = []
    ok = True
    try:
        recepcion(token, "L-QA-I1", 25, "2026-07-05")
        recepcion(token, "L-QA-I2", 25, "2026-07-05")
        emp_i = empaque_campo(
            token,
            fecha="2026-07-19",
            consumos=[
                {"lote": "L-QA-I1", "bins": 10},
                {"lote": "L-QA-I2", "bins": 10},
            ],
            produccion=[
                {"presentacion": "rpc_18", "talla": "165", "cantidad": 100},
            ],
        )
        d = dash(token)
        ok &= check(desv_bins(d, "L-QA-I1") == 15, "I: I1=15", checks)
        ok &= check(desv_bins(d, "L-QA-I2") == 15, "I: I2=15", checks)
        r = rend(token)
        c_i = next((x for x in (r.get("corridas") or []) if x["id"] == emp_i["id"]), None)
        ok &= check(c_i is not None and c_i.get("bins_campo") == 20, "I: bins 20 en reporte", checks)
        lotes = r.get("por_lote") or []
        # prorrateo 50/50
        l1 = next((l for l in lotes if l["lote"] == "L-QA-I1"), None)
        l2 = next((l for l in lotes if l["lote"] == "L-QA-I2"), None)
        if l1 and l2:
            ok &= check(
                abs(float(l1["kg_primera"]) - float(l2["kg_primera"])) < 1,
                f"I: prorrateo kg1 {l1['kg_primera']} vs {l2['kg_primera']}",
                checks,
            )
        RESULTS.append(Result("I. Multi-lote + prorrateo reportes", ok, checks=checks))
        log(("PASS" if ok else "FAIL") + " I. Multi-lote")
    except Exception as e:
        RESULTS.append(Result("I. Multi-lote + prorrateo reportes", False, str(e), checks))
        log(f"FAIL I: {e}")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    log("\n========== RESUMEN ==========")
    passed = sum(1 for r in RESULTS if r.ok)
    failed = [r for r in RESULTS if not r.ok]
    for r in RESULTS:
        mark = "✓" if r.ok else "✗"
        log(f"{mark} {r.name}")
        if not r.ok:
            if r.detail:
                log(f"    error: {r.detail}")
            for c in r.checks:
                if c.startswith("FAIL"):
                    log(f"    {c}")
    log(f"\n{passed}/{len(RESULTS)} escenarios OK")
    if failed:
        log("\nDetalle fallos:")
        for r in failed:
            log(f"\n## {r.name}")
            for c in r.checks:
                log(f"  {c}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(run())
