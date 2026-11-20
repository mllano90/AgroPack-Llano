"""Factor PAR, validación y DLI diario (Hermosillo), incluidos los huecos largos."""
import time

from conftest import cx, login

from test_api import API, csv, ingesta
from estacion import config as cfgmod
from estacion import servicio as sv


def test_integrar_dli_descarta_hueco_mayor_a_20_min():
    """100 W/m² × 2.02 × 600 s / 1e6 = 0.1212 mol. Un salto de 21 min no suma;
    un salto de exactamente 20 min sí. El tramo siguiente vuelve a contar."""
    fac = 2.02
    diez = 100 * fac * 600 / 1_000_000
    assert abs(diez - 0.1212) < 1e-12
    pts = [(0, 100.0), (600, 80.0), (600 + 21 * 60, 200.0), (600 + 21 * 60 + 600, 0.0)]
    assert abs(sv.integrar_dli(pts, fac) - (diez + 200 * fac * 600 / 1_000_000)) < 1e-9
    assert abs(sv.integrar_dli([(0, 100.0), (20 * 60, 0.0)], fac) - 100 * fac * 1200 / 1_000_000) < 1e-9
    assert sv.integrar_dli([(0, 100.0), (20 * 60 + 1, 0.0)], fac) == 0.0
    assert sv.integrar_dli([(0, 100.0)], fac) == 0.0


def test_factor_par_guardar_leer_y_dli(cliente):
    login(cliente)
    cfg = cliente.get(f"{API}/config").json()
    assert cfg["factor_par"] == 2.02
    vacio = cliente.get(f"{API}/ultimo").json()
    assert vacio["factor_par"] == 2.02 and vacio["par_actual"] is None and vacio["dli_hoy"] is None

    c = cx(cliente)
    cfgmod.guardar(c, {"nombre_nodo": "Viejo", "sin_datos_min": 12, "offline_min": 6,
                       "bateria_min_v": 3.4, "umbrales": {}})
    c.commit()
    viejo = cliente.get(f"{API}/config").json()
    assert viejo["factor_par"] == 2.02 and viejo["nombre_nodo"] == "Viejo"

    malo = dict(viejo, factor_par=0.49)
    assert cliente.put(f"{API}/config", json=malo).status_code == 400
    assert cliente.put(f"{API}/config", json=dict(viejo, factor_par=4.51)).status_code == 400
    ok = cliente.put(f"{API}/config", json=dict(viejo, factor_par=2.5))
    assert ok.status_code == 200 and ok.json()["config"]["factor_par"] == 2.5
    assert cliente.get(f"{API}/config").json()["factor_par"] == 2.5

    assert cliente.post(f"{API}/usuarios", json={"usuario": "visorpar", "clave": "Visor2468ok"}).status_code == 200
    vis = cliente.post(f"{API}/auth/login", json={"usuario": "visorpar", "clave": "Visor2468ok"})
    hv = {"Authorization": "Bearer " + vis.json()["token"]}
    assert cliente.put(f"{API}/config", json=dict(viejo, factor_par=3), headers=hv).status_code == 403

    ahora = int(time.time())
    dia = sv._inicio_dia_hmo(ahora)
    # Cuatro lecturas en la última hora, todas de hoy salvo si el día acaba de empezar.
    p2 = ahora - 70
    p1 = p2 - 600
    p3 = p2 + 21 * 60
    if p3 >= ahora:
        p3 = ahora - 5
    p4 = min(ahora - 1, p3 + 600)
    if p4 <= p3:
        p4 = p3
    ingesta(cliente, [
        {"csv": csv(1, p1, pir=100)},
        {"csv": csv(2, p2, pir=100)},
        {"csv": csv(3, p3, pir=50)},
        {"csv": csv(4, p4, pir=50)},
    ])
    login(cliente)
    u = cliente.get(f"{API}/ultimo").json()
    assert u["factor_par"] == 2.5
    assert u["par_actual"] == round(50 * 2.5, 1)
    pts = [(ts, w) for ts, w in ((p1, 100.0), (p2, 100.0), (p3, 50.0), (p4, 50.0)) if dia <= ts <= ahora]
    esperado = None if len(pts) < 2 else round(sv.integrar_dli(pts, 2.5), 4)
    assert u["dli_hoy"] == esperado
    # El hueco de 21 min no entra en la integral, aunque las cuatro lecturas sean de hoy.
    if p1 >= dia and p4 > p3 and p3 - p2 > 20 * 60:
        solo = round(sv.integrar_dli([(p1, 100.0), (p2, 100.0), (p3, 50.0), (p4, 50.0)], 2.5), 4)
        con_hueco = round(sv.integrar_dli([(p1, 100.0), (p2, 100.0), (p3, 50.0), (p4, 50.0)], 2.5, hueco_max_s=3600), 4)
        assert u["dli_hoy"] == solo < con_hueco

    visto = cliente.get(f"{API}/ultimo", headers=hv).json()
    assert visto["factor_par"] == 2.5 and visto["par_actual"] == u["par_actual"] and visto["dli_hoy"] == u["dli_hoy"]

    h = cliente.get(f"{API}/historial?var=par&rango=24h", headers=hv).json()
    assert h["factor_par"] == 2.5
    assert h["dli_hoy"] == u["dli_hoy"]
    assert h["dli_promedio"] is not None
    assert all(p["prom"] == round(p["prom"], 3) for p in h["puntos"])
    assert any(abs(p["prom"] - 100 * 2.5) < 0.01 or abs(p["prom"] - 50 * 2.5) < 0.01 or abs(p["min"] - 50 * 2.5) < 0.01 for p in h["puntos"])
    rep = cliente.get(f"{API}/reporte?rango=24h").json()
    assert rep["variables"]["par"]["nombre"] == "Luz PAR"
    assert rep["variables"]["par"]["unidad"] == "µmol/m²/s"
    assert rep["orden"][rep["orden"].index("pir") + 3] == "par"
