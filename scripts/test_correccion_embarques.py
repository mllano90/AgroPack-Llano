#!/usr/bin/env python3
"""
Prueba E2E: embarque → descuenta inventario → eliminar embarque → restaura exacto.
Detecta sumas fantasma (líneas nuevas o deltas incorrectos).

Uso:
  cd backend && .venv/bin/python ../scripts/test_correccion_embarques.py
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "http://127.0.0.1:8001"
USER = "admin"
PASS = "admin123"


def req(method, path, token=None, body=None, form=None):
    url = API.rstrip("/") + path
    data = None
    headers = {}
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
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"detail": raw}


def stock_map(token) -> dict[tuple, int]:
    """(pres, talla, mercado) -> stock; also total and line count"""
    _, dash = req("GET", "/api/reports/dashboard", token=token)
    m: dict[tuple, int] = {}
    for i in dash.get("inventario_final") or []:
        key = (
            i.get("presentacion") or "",
            str(i.get("talla") or ""),
            str(i.get("mercado") or ""),
        )
        m[key] = m.get(key, 0) + int(i.get("cantidad_stock") or 0)
    return m


def total_stock(m: dict) -> int:
    return sum(m.values())


def login() -> str:
    code, d = req("POST", "/api/auth/login", form={"username": USER, "password": PASS})
    if code != 200 or not d.get("access_token"):
        raise SystemExit(f"login fail {code} {d}")
    return d["access_token"]


def main() -> int:
    print("=== Test corrección embarques (devolver inventario) ===\n")
    token = login()
    errors: list[str] = []

    before = stock_map(token)
    n_lines_before = len(before)
    total_before = total_stock(before)
    print(f"1. Inventario inicial: {n_lines_before} SKUs · {total_before} unidades")
    for k, v in sorted(before.items()):
        if v > 0:
            print(f"   {k}: {v}")

    # Find SKUs with enough stock
    rpc140 = next(
        (
            (k, v)
            for k, v in before.items()
            if k[0] == "rpc_18" and k[1] == "140" and v >= 50
        ),
        None,
    )
    cart95 = next(
        (
            (k, v)
            for k, v in before.items()
            if k[0] == "caja_40lbs" and k[1] == "95" and v >= 20
        ),
        None,
    )
    if not rpc140:
        # pick any rpc_18 with stock
        rpc140 = next(
            ((k, v) for k, v in before.items() if k[0] == "rpc_18" and v >= 50),
            None,
        )
    if not rpc140:
        print("FAIL: no hay stock RPC suficiente para prueba")
        return 1

    talla_rpc = rpc140[0][1]
    merc = rpc140[0][2] or "nacional"
    cant_rpc = 50
    cant_cart = 20 if cart95 else 0

    # clientes
    _, clientes = req("GET", "/api/clientes/", token=token)
    if not clientes:
        print("FAIL: sin clientes")
        return 1
    cid = clientes[0]["id"]

    detalles = [
        {
            "producto": "limon_amarillo",
            "mercado": merc if merc in ("nacional", "exportacion") else "nacional",
            "presentacion": "rpc_18",
            "talla": talla_rpc,
            "calidad": "primera",
            "cantidad_cajas": cant_rpc,
            "cajas_por_parrilla": 45,
        }
    ]
    if cart95:
        detalles.append(
            {
                "producto": "limon_amarillo",
                "mercado": merc if merc in ("nacional", "exportacion") else "nacional",
                "presentacion": "caja_40lbs",
                "talla": cart95[0][1],
                "calidad": "primera",
                "cantidad_cajas": cant_cart,
                "cajas_por_parrilla": 63,
            }
        )

    print(f"\n2. Crear embarque cliente={cid} detalles={detalles}")
    code, emb = req(
        "POST",
        "/api/embarques/",
        token=token,
        body={"cliente_id": cid, "notas": "TEST corrección E2E", "detalles": detalles},
    )
    if code not in (200, 201):
        print(f"FAIL crear embarque {code} {emb}")
        return 1
    emb_id = emb.get("id")
    print(f"   OK embarque #{emb_id}")

    mid = stock_map(token)
    total_mid = total_stock(mid)
    expected_drop = cant_rpc + cant_cart
    if total_mid != total_before - expected_drop:
        errors.append(
            f"Tras embarque: total {total_mid} esperado {total_before - expected_drop}"
        )
    key_rpc = ("rpc_18", str(talla_rpc), merc if merc else "nacional")
    # mercado may be enum string
    found_rpc = None
    for k, v in mid.items():
        if k[0] == "rpc_18" and k[1] == str(talla_rpc):
            found_rpc = (k, v)
            break
    if found_rpc:
        exp = rpc140[1] - cant_rpc
        if found_rpc[1] != exp:
            errors.append(
                f"RPC stock tras embarque {found_rpc[1]} esperado {exp} (key {found_rpc[0]})"
            )
        print(f"   RPC {found_rpc[0]}: {rpc140[1]} → {found_rpc[1]} (esp {exp})")
    else:
        errors.append("RPC line disappeared after embarque")

    n_mid = len(mid)
    print(f"   SKUs ahora: {n_mid} (antes {n_lines_before})")

    print(f"\n3. Eliminar embarque #{emb_id} (devolver inventario)")
    code, delres = req("DELETE", f"/api/correcciones/embarque/{emb_id}", token=token)
    if code != 200:
        print(f"FAIL eliminar {code} {delres}")
        return 1
    print(f"   {delres.get('message')}")
    rest = delres.get("restaurado") or []
    for r in rest:
        print(
            f"   restore: {r.get('presentacion')} #{r.get('talla')} "
            f"{r.get('antes')}→{r.get('despues')} (+{r.get('delta')}) "
            f"created={r.get('created')} inv={r.get('inv_id')}"
        )
        if r.get("created"):
            errors.append(
                f"Se creó línea NUEVA de inventario (fantasma?): {r}"
            )

    after = stock_map(token)
    total_after = total_stock(after)
    n_after = len(after)
    print(f"\n4. Inventario final: {n_after} SKUs · {total_after} unidades")

    if total_after != total_before:
        errors.append(
            f"Total stock no restaurado: {total_after} vs inicial {total_before}"
        )
    else:
        print("   ✓ Total unidades idéntico al inicial")

    # Compare key by key (normalize mercado differences)
    def by_sku(m):
        out = {}
        for (pres, talla, merc), v in m.items():
            k = (pres, talla)
            out[k] = out.get(k, 0) + v
        return out

    b_sku = by_sku(before)
    a_sku = by_sku(after)
    all_keys = set(b_sku) | set(a_sku)
    for k in sorted(all_keys):
        bv, av = b_sku.get(k, 0), a_sku.get(k, 0)
        if bv != av:
            errors.append(f"SKU {k}: antes={bv} después={av}")
        else:
            if bv > 0:
                print(f"   ✓ {k}: {av}")

    # Double delete must fail
    print(f"\n5. Re-eliminar #{emb_id} debe fallar")
    code2, del2 = req("DELETE", f"/api/correcciones/embarque/{emb_id}", token=token)
    if code2 == 404:
        print("   ✓ 404 (correcto)")
    else:
        errors.append(f"Re-eliminar debería 404, got {code2} {del2}")

    # Cycle 2: create + delete again
    print("\n6. Segundo ciclo embarque/eliminar")
    code, emb2 = req(
        "POST",
        "/api/embarques/",
        token=token,
        body={
            "cliente_id": cid,
            "notas": "Test ciclo 2",
            "detalles": [
                {
                    "producto": "limon_amarillo",
                    "mercado": "nacional",
                    "presentacion": "rpc_18",
                    "talla": talla_rpc,
                    "calidad": "primera",
                    "cantidad_cajas": 10,
                    "cajas_por_parrilla": 45,
                }
            ],
        },
    )
    if code not in (200, 201):
        errors.append(f"ciclo2 create {code} {emb2}")
    else:
        eid2 = emb2["id"]
        code, _ = req("DELETE", f"/api/correcciones/embarque/{eid2}", token=token)
        if code != 200:
            errors.append(f"ciclo2 delete {code}")
        else:
            after2 = stock_map(token)
            if total_stock(after2) != total_before:
                errors.append(
                    f"ciclo2 total {total_stock(after2)} != {total_before}"
                )
            else:
                print("   ✓ Segundo ciclo restaura total")

    print("\n========== RESULTADO ==========")
    if errors:
        print(f"FAIL ({len(errors)} problemas):")
        for e in errors:
            print(f"  ✗ {e}")
        return 1
    print("PASS: embarque descuenta y corrección restaura sin fantasmas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
