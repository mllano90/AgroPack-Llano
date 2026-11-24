"""Cálculo, ingesta, backfill e historial de la condensación de la caja."""
import time

from conftest import cx, login

from test_api import API, csv, csv_caja, ingesta
from estacion.condensacion import condensacion_pct, punto_rocio, rellenar_condensacion


def test_condensacion_nulos_baja_media_y_saturacion():
    assert condensacion_pct(None, 66) is None
    assert condensacion_pct(15.2, None) is None
    assert punto_rocio(15.2, None) is None
    # 15.2 °C. Los ejemplos del encargo son aproximados; aquí queda el redondeo exacto de la fórmula.
    assert round(punto_rocio(15.2, 66), 1) == 8.9
    assert abs((15.2 - punto_rocio(15.2, 66)) - 6.3) < 0.05
    assert condensacion_pct(15.2, 66) == 3.4          # ~3.5 %
    assert condensacion_pct(15.2, 85) == 56.9         # riesgo medio, ~59 %
    assert condensacion_pct(15.2, 95) == 87.0
    assert condensacion_pct(15.2, 98) == 100.0
    assert condensacion_pct(15.2, 100) == 100.0
    assert condensacion_pct(15.2, 50) == 0.0          # ΔT > 10 °C
    assert condensacion_pct(15.2, 0) == 0.0
    assert condensacion_pct(15.2, 66) != 0


def test_ingesta_guarda_condensacion_y_el_historial_no_rellena_ceros(cliente):
    t = int(time.time())
    ingesta(cliente, [
        {"csv": csv_caja(1, t - 600, tint=152, hint=660)},
        {"csv": csv(2, t - 300)},                       # sin caja: el porcentaje queda NULL, no 0
        {"csv": csv_caja(3, t - 60, tint=152, hint=850)},
    ])
    login(cliente)
    u = cliente.get(f"{API}/ultimo").json()
    assert u["caja_condensacion_pct"] == 56.9
    assert u["caja_punto_rocio"] == round(punto_rocio(15.2, 85), 1)
    c = cx(cliente)
    filas = c.todos("SELECT seq, caja_condensacion_pct FROM estacion_lecturas ORDER BY seq")
    assert [f["caja_condensacion_pct"] for f in filas] == [3.4, None, 56.9]
    h = cliente.get(f"{API}/historial?var=caja_condensacion_pct&rango=24h").json()
    assert sum(p["n"] for p in h["puntos"]) == 2
    assert min(p["min"] for p in h["puntos"]) == 3.4
    assert max(p["max"] for p in h["puntos"]) == 56.9
    assert all(p["min"] > 0 and p["prom"] > 0 for p in h["puntos"])
    rep = cliente.get(f"{API}/reporte?rango=24h").json()
    assert rep["variables"]["caja_condensacion_pct"]["nombre"] == "Condensación caja"
    assert rep["variables"]["caja_condensacion_pct"]["unidad"] == "%"


def test_backfill_solo_rellena_filas_con_caja(cliente):
    t = int(time.time())
    ingesta(cliente, [
        {"csv": csv_caja(1, t - 120, tint=152, hint=950)},
        {"csv": csv(2, t - 60)},
    ])
    c = cx(cliente)
    assert c.ejecutar("UPDATE estacion_lecturas SET caja_condensacion_pct = NULL") == 2
    c.commit()
    assert rellenar_condensacion(c) == 1
    c.commit()
    assert rellenar_condensacion(c) == 0
    filas = {f["seq"]: f["caja_condensacion_pct"] for f in c.todos("SELECT seq, caja_condensacion_pct FROM estacion_lecturas")}
    assert filas[1] == 87.0
    assert filas[2] is None
