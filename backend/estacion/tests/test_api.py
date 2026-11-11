import time

from conftest import auth, cx, login, procesar

import simulador
from estacion import servicio as sv

T0 = 1793385300  # 2026-10-31 ~10:15 Hermosillo
API = "/api/estacion"


def csv(seq, epoch, tipo="D", eA1=0, t1=253, h1=550, eA2=0, t2=257, h2=540, ePir=0, pir=420, eS=0, hs=612, ts=241,
        ec=1830, ph=62, n=120, p=80, k=100, nnpk=6, edad=5, f=0, mn=2, tot=30):
    return f"{tipo},{seq},{eA1},{t1},{h1},{eA2},{t2},{h2},{ePir},{pir},{eS},{hs},{ts},{ec},{ph},{n},{p},{k},{nnpk},{edad},{f},{mn},{tot},{epoch}"


def ingesta(c, regs, nodo="nodo1", headers=None):
    return c.post(f"{API}/v1/ingesta", json={"nodo": nodo, "registros": regs}, headers=auth() if headers is None else headers)


def alertas(c, estado="todas"):
    return c.get(f"{API}/alertas?estado={estado}&limite=1000").json()["alertas"]


def T(now=None):
    return now or T0 + 86400


# ---------------------------------------------------------------- auth
def test_ingesta_requiere_token(cliente):
    r = [{"csv": csv(1, T0)}]
    assert ingesta(cliente, r, headers={}).status_code == 401
    assert ingesta(cliente, r, headers={"Authorization": "Bearer malo"}).status_code == 401
    assert cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1"}).status_code == 401
    assert cliente.post(f"{API}/v1/comandos/1/estado", json={"estado": "activo"}).status_code == 401
    assert ingesta(cliente, r).status_code == 200


def test_ui_requiere_jwt_propio(cliente):
    assert cliente.get(f"{API}/ultimo").status_code == 401
    assert cliente.post(f"{API}/auth/login", json={"usuario": "admin", "clave": "mala"}).status_code == 401
    # el token de ingesta NO da acceso a la interfaz, ni un JWT firmado con otro secreto
    assert cliente.get(f"{API}/ultimo", headers=auth()).status_code == 401
    from estacion import auth as A
    from estacion.ajustes import ajustes
    bueno, _ = A.crear_jwt("admin")
    viejo = ajustes.secreto
    ajustes.secreto = "secreto-de-agropack"
    ajeno, _ = A.crear_jwt("admin")
    ajustes.secreto = viejo
    assert cliente.get(f"{API}/ultimo", headers={"Authorization": f"Bearer {ajeno}"}).status_code == 401
    assert cliente.get(f"{API}/ultimo", headers={"Authorization": f"Bearer {bueno}"}).status_code == 200
    # y el JWT de la interfaz NO sirve como token de ingesta
    assert ingesta(cliente, [{"csv": csv(1, T0)}], headers={"Authorization": f"Bearer {bueno}"}).status_code == 401
    login(cliente)
    assert cliente.get(f"{API}/ultimo").status_code == 200
    assert cliente.get(f"{API}/auth/yo").json() == {"usuario": "admin", "rol": "admin"}


def test_resumen_del_dia(cliente):
    t = int(time.time())
    def linea(seq, epoch, t1):
        return f"D,{seq},0,{t1},500,0,{t1},500,0,900,0,400,200,1000,60,80,40,90,6,2,0,2,30,0,250,400,{epoch}"
    ingesta(cliente, [{"csv": linea(1, t - 600, 200)}, {"csv": linea(2, t - 60, 390)}])
    login(cliente)
    aire = cliente.get(f"{API}/resumen-dia").json()["vars"]["t_aire"]
    assert aire["min"] == 20 and aire["max"] == 39
    assert aire["s_max"] >= 60 and aire["s_min"] >= 60
    ven = cliente.get(f"{API}/historial?var=t_aire&desde={t - 3600}&hasta={t + 30}")
    assert ven.status_code == 200 and ven.json()["rango"] == "ventana" and ven.json()["paso_s"] == 120


def test_admin_crea_cuenta_normal_y_el_normal_no_administra(cliente):
    login(cliente)
    malo = [
        {"usuario": "ab", "clave": "Visor2468ok"},
        {"usuario": "visor 1", "clave": "Visor2468ok"},
        {"usuario": "visor1", "clave": "corta1"},
        {"usuario": "visor1", "clave": "sololetras"},
        {"usuario": "visor1", "clave": "qwertyuiop"},
        {"usuario": "cuentalarga", "clave": "cuentalarga"},
    ]
    for cuerpo in malo:
        assert cliente.post(f"{API}/usuarios", json=cuerpo).status_code == 400
    alta = cliente.post(f"{API}/usuarios", json={"usuario": "visor1", "clave": "Visor2468ok", "rol": "admin"})
    assert alta.status_code == 200 and alta.json()["rol"] == "normal"
    assert cliente.post(f"{API}/usuarios", json={"usuario": "visor1", "clave": "OtraClave2468"}).status_code == 409
    nombres = {u["usuario"]: u["rol"] for u in cliente.get(f"{API}/usuarios").json()["usuarios"]}
    assert nombres["visor1"] == "normal" and nombres["admin"] == "admin"
    assert "hash" not in alta.text
    vis = cliente.post(f"{API}/auth/login", json={"usuario": "visor1", "clave": "Visor2468ok"})
    assert vis.status_code == 200 and vis.json()["rol"] == "normal"
    hv = {"Authorization": "Bearer " + vis.json()["token"]}
    assert cliente.get(f"{API}/usuarios", headers=hv).status_code == 403
    assert cliente.get(f"{API}/config", headers=hv).status_code == 403
    assert cliente.put(f"{API}/config", json={"nombre_nodo": "Casa"}, headers=hv).status_code == 403
    assert cliente.post(f"{API}/usuarios", json={"usuario": "otro2", "clave": "OtraClave2468"}, headers=hv).status_code == 403
    assert cliente.post(f"{API}/comandos", json={"duracion_min": 15}, headers=hv).status_code == 403
    assert cliente.post(f"{API}/alertas/1/resolver", headers=hv).status_code == 403
    assert cliente.get(f"{API}/ultimo", headers=hv).status_code == 200
    assert cliente.get(f"{API}/alertas", headers=hv).status_code == 200
    assert cliente.get(f"{API}/historial?var=t_aire&rango=24h", headers=hv).status_code == 200
    assert cliente.get(f"{API}/historial?var=t_caja&rango=24h", headers=hv).status_code == 200
    assert cliente.get(f"{API}/historial?var=h_caja&rango=24h", headers=hv).status_code == 200
    assert cliente.get(f"{API}/wifi", headers=hv).status_code == 403
    assert cliente.get(f"{API}/enlace", headers=hv).status_code == 403
    assert cliente.post(f"{API}/enlace", json={"accion": "prueba", "n": 0}, headers=hv).status_code == 403
    rep = cliente.get(f"{API}/reporte?rango=24h", headers=hv)
    assert rep.status_code == 200 and rep.json()["orden"].index("h_aire") < rep.json()["orden"].index("t_caja") < rep.json()["orden"].index("t_suelo")
    assert "h_caja" in rep.json()["orden"]
    assert cliente.get(f"{API}/resumen-dia", headers=hv).status_code == 200
    anon = {"Authorization": ""}
    assert cliente.get(f"{API}/usuarios", headers=anon).status_code == 401
    assert cliente.get(f"{API}/ultimo", headers=anon).status_code == 401
    assert cliente.post(f"{API}/usuarios", json={"usuario": "otro2", "clave": "OtraClave2468"}, headers=anon).status_code == 401


# ---------------------------------------------------------------- decodificación
# Texto exacto del snprintf de v4.5.2 (caja ANTES del epoch). Índices: 23 eInt, 24 Tint, 25 Hint, 26 epoch.
EXACTO_27 = "D,7,0,253,550,0,257,540,0,420,0,612,241,1830,62,120,80,100,6,5,0,8,30,0,310,615,1793385300"
# El orden invertido (caja después del epoch) no es el firmware: se rechaza.
INVERTIDO = "D,7,0,253,550,0,257,540,0,420,0,612,241,1830,62,120,80,100,6,5,0,8,30,1793385300,0,310,615"
# 26 campos: v4.5 con caja y sin epoch (receptora_logica.h, nNum == 25).
EXACTO_26 = "D,9,0,253,550,0,257,540,0,420,0,612,241,1830,62,120,80,100,6,5,0,8,30,0,280,500"
# Paquete viejo reescrito por csvDe: eInt 255, Tint 0, Hint 0, epoch al final.
EXACTO_255 = "D,4,0,253,550,0,257,540,0,420,0,612,241,1830,62,120,80,100,6,5,0,2,30,255,0,0,1793386000"


def test_paquete_27_firmware_v452(cliente):
    """CSV y JSON como los arma la receptora v4.5.2. La caja va antes del epoch."""
    assert EXACTO_27.split(",")[23:27] == ["0", "310", "615", "1793385300"]
    assert len(EXACTO_27.split(",")) == 27 and len(EXACTO_26.split(",")) == 26
    reg = {
        "id": "0000002a-15", "boot_id": "0000002a", "csv": EXACTO_27,
        "rx": T0 + 2, "rssi": -91, "snr": 7.5, "tipo": "D", "seq": 7,
        "errA1": 0, "t1": 99.9, "h1": 1.0, "errCaja": 0, "t_caja": 1.0, "h_caja": 2.0,
        "errPir": 0, "pir": 1, "errSuelo": 0, "hs": 1.0, "ts": 2.0,
        "epoch_medicion": T0, "epoch_recepcion": T0 + 2, "reinicios_emisora": 1,
    }
    r = ingesta(cliente, [reg]).json()
    assert r["ok"] is True and r["aceptados"] == 1 and r["duplicados"] == 0 and r["rechazados"] == []
    assert r["ultimo_id"] == "nodo1:id:0000002a-15"
    assert ingesta(cliente, [reg]).json()["duplicados"] == 1
    login(cliente)
    u = cliente.get(f"{API}/ultimo").json()
    # Manda el csv, no el t1/t_caja del JSON (esos 99.9 y 1.0 son una contradicción a propósito).
    assert u["aire"]["t"] == 25.5 and u["aire"]["a1"]["t"] == 25.3 and u["aire"]["h"] == 54.5
    assert u["pir"]["v"] == 420 and u["suelo"]["h"] == 61.2 and u["suelo"]["t"] == 24.1
    assert u["npk"]["ec"] == 1.83 and u["npk"]["ph"] == 6.2
    assert u["ts"] == T0 and u["interno"]["ok"] is True
    assert u["interno"]["t"] == 31.0 and u["interno"]["h"] == 61.5
    # 26 campos, sin epoch: la hora sale de rx y la caja se lee igual.
    rx = T0 + 500
    j = ingesta(cliente, [{"csv": EXACTO_26, "rx": rx, "id": "0000002a-16"}]).json()
    assert j["aceptados"] == 1
    u = cliente.get(f"{API}/ultimo").json()
    assert u["seq"] == 9 and u["ts"] == rx and u["sin_hora_emisora"] and u["interno"]["t"] == 28.0
    # eInt 255 (paquete viejo reescrito): no es 0 °C y no toca el aire.
    ingesta(cliente, [{"csv": EXACTO_255, "rx": T0 + 3, "id": "0000002a-17"}])
    u = cliente.get(f"{API}/ultimo").json()
    assert u["aire"]["t"] == 25.5 and u["interno"]["ok"] is False and u["interno"]["codigo"] == 255
    assert u["interno"]["t"] is None
    # Caja después del epoch, un campo de menos, o '+' : se rechazan.
    corto = EXACTO_27.rsplit(",", 2)[0]
    j = ingesta(cliente, [{"csv": INVERTIDO}, {"csv": corto}, {"csv": EXACTO_27.replace(",0,310,", ",+0,310,", 1)}]).json()
    assert j["aceptados"] == 0 and len(j["rechazados"]) == 3
    # 24 campos sigue sin caja.
    ingesta(cliente, [{"csv": csv(11, T0 + 800), "id": "0000002a-18"}])
    u = cliente.get(f"{API}/ultimo").json()
    assert u["seq"] == 11 and u["interno"] is None
    # Latido v4.5 con los campos extra de la receptora. Los que no están en la tabla no tumban el POST.
    lat = {"nodo": "nodo1", "recibidos": 10, "perdidos": 1, "duplicados": 0, "reinicios_emisora": 0,
           "err_crc": 0, "err_formato": 0, "radio_reinit": 0, "heap": 180000, "heap_min": 100000,
           "cola_pendiente": 3, "uptime_s": 3600, "firmware": "v4.5.2", "rssi_wifi": -62, "ts": T0,
           "version": "v4.5.2", "cola_perdidos": 0, "cola_corruptos": 0, "subidas_ok": 4,
           "subidas_fallidas": 0, "comandos_lora": 0, "avisos_lora": 0,
           "wifi_ssid": "casa", "wifi_fuente": "nvs", "wifi_con_clave": True}
    est = cliente.post(f"{API}/v1/estado", json=lat, headers=auth())
    assert est.status_code == 200 and est.json()["ok"] is True and est.json()["comandos"] == []


def test_decodificacion_y_unidades(cliente):
    r = ingesta(cliente, [{"csv": csv(7, T0, mn=8, edad=5), "rssi": -91, "snr": 7.5, "rx": T0 + 2}]).json()
    assert r["aceptados"] == 1
    login(cliente)
    u = cliente.get(f"{API}/ultimo").json()
    assert u["aire"]["t"] == 25.5 and u["aire"]["a1"]["t"] == 25.3
    assert u["pir"]["v"] == 420
    assert u["npk"]["ec"] == 1.83 and u["npk"]["ph"] == 6.2 and u["npk"]["ts"] == T0 - 300   # uS/cm -> dS/m
    assert u["suelo"]["ts"] == T0 - 120   # minFase 8 => lectura del min 6 (paquete anterior)
    assert u["ts"] == T0 and u["rssi"] == -91


def test_error_sensor_no_es_cero(cliente):
    ingesta(cliente, [{"csv": csv(1, T0, eA1=0xE2, t1=0, h1=0, ePir=0xE3, pir=0, eS=0xF0)}])
    procesar(cliente, T0 + 60)
    login(cliente)
    u = cliente.get(f"{API}/ultimo").json()
    assert u["aire"]["a1"]["ok"] is False and u["aire"]["a1"]["t"] is None
    assert u["aire"]["t"] == 25.7            # promedio solo del sensor válido (Aire2)
    assert u["pir"]["v"] is None and "CRC" in u["pir"]["error"]
    assert u["suelo"]["t"] is None
    claves = {a["clave"] for a in alertas(cliente, "activa")}
    assert {"err:A1", "err:Pir", "err:Suelo"} <= claves


def test_sin_epoch_usa_recepcion(cliente):
    t = int(time.time())
    r = ingesta(cliente, [{"csv": csv(3, 0, edad=-1), "rx": t - 10}]).json()
    assert r["aceptados"] == 1 and r["ultimo_id"] == f"nodo1:3:rx{t - 10}"
    d = ingesta(cliente, [{"csv": csv(3, 0, edad=-1), "rx": t - 9}]).json()     # duplicado LoRa sin hora
    assert (d["aceptados"], d["duplicados"]) == (0, 1)
    login(cliente)
    u = cliente.get(f"{API}/ultimo").json()
    assert u["ts"] == t - 10 and u["sin_hora_emisora"] and u["npk"] is None
    c23 = csv(4, 0).rsplit(",", 1)[0]                                           # 23 campos (v3/v4)
    assert ingesta(cliente, [{"csv": c23, "rx": t}]).json()["aceptados"] == 1


# ---------------------------------------------------------------- idempotencia
def test_idempotencia(cliente):
    t0 = int(time.time()) - 86400
    regs = [{"csv": csv(i, t0 + i * 120), "rssi": -90, "snr": 8, "rx": t0 + i * 120 + 1} for i in range(50)]
    a = ingesta(cliente, regs).json()
    assert (a["aceptados"], a["duplicados"]) == (50, 0)
    b = ingesta(cliente, regs).json()
    assert (b["aceptados"], b["duplicados"]) == (0, 50)
    assert b["ultimo_id"] == f"nodo1:49:{t0 + 49 * 120}"
    c = ingesta(cliente, [dict(regs[3], rx=t0 + 999, rssi=-70)]).json()      # duplicado LoRa (mismo seq+epoch)
    assert c["duplicados"] == 1
    k = cx(cliente)
    assert k.uno("SELECT COUNT(*) AS n FROM estacion_lecturas")["n"] == 50
    k.s.close()


def test_lote_parcialmente_invalido_y_limites(cliente):
    t0 = int(time.time()) - 3600
    regs = [{"csv": csv(1, t0)}, {"csv": "D,2,0,abc"}, {"csv": csv(3, t0 + 240), "rssi": "x"}, "no-objeto",
            {"csv": csv(4, t0 + 360).replace("D,", "Z,", 1)}, {"csv": csv(5, 123)}, {"csv": csv(6, t0 + 720, eA1=300)},
            {"csv": csv(7, t0 + 840)}, {"csv": csv(8, T0 - 40 * 86400)}]
    r = ingesta(cliente, regs)
    assert r.status_code == 200
    j = r.json()
    assert j["aceptados"] == 2 and [x["i"] for x in j["rechazados"]] == [1, 2, 3, 4, 5, 6, 8]
    assert "retención" in j["rechazados"][-1]["error"]
    assert ingesta(cliente, [{"csv": "basura"}]).status_code == 400
    assert cliente.post(f"{API}/v1/ingesta", content=b"{no json", headers=auth()).status_code == 400
    assert cliente.post(f"{API}/v1/ingesta", json={"nodo": "nodo1"}, headers=auth()).status_code == 400
    assert cliente.post(f"{API}/v1/ingesta", json={"nodo": "n o d o", "registros": []}, headers=auth()).status_code == 400
    assert ingesta(cliente, [{"csv": csv(1, t0)}] * 201).status_code == 413                 # tope de lote
    grande = b'{"nodo":"nodo1","registros":[' + b'{"csv":"' + b"x" * 300000 + b'"}]}'
    assert cliente.post(f"{API}/v1/ingesta", content=grande, headers=auth()).status_code == 413   # tope de cuerpo


def test_rate_limit_por_token(cliente):
    from estacion.ajustes import ajustes
    ajustes.rate_por_min = 5
    try:
        st = [cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1"}, headers=auth()).status_code for _ in range(7)]
    finally:
        ajustes.rate_por_min = 30
    assert st == [200] * 5 + [429] * 2


def test_500_sin_detalles(cliente, monkeypatch):
    def explota(*a, **k):
        raise RuntimeError("password=supersecreto tabla users")
    monkeypatch.setattr(sv, "ingestar", explota)
    r = ingesta(cliente, [{"csv": csv(1, T0)}])
    assert r.status_code == 500 and r.json() == {"ok": False, "error": "error interno"}
    assert "supersecreto" not in r.text


# ---------------------------------------------------------------- alertas
def test_alertas_rango_hueco_reinicio(cliente):
    regs = [{"csv": csv(i, T0 + i * 120, t1=253, t2=257)} for i in range(5)]
    regs.append({"csv": csv(5, T0 + 600, t1=400, t2=402)})                 # 40 °C > 35
    regs.append({"csv": csv(6, T0 + 600 + 3600, t1=253, t2=257)})          # hueco de 60 min
    regs.append({"csv": csv(0, T0 + 600 + 3720)})                          # seq vuelve a 0 => reinicio
    ingesta(cliente, regs)
    procesar(cliente, T0 + 600 + 3800)
    login(cliente)
    por = {}
    for a in alertas(cliente):
        por.setdefault(a["clave"], []).append(a)
    assert por["rango:t_aire"][0]["estado"] == "resuelta" and "alto" in por["rango:t_aire"][0]["mensaje"]
    assert por["sin_datos"][0]["estado"] == "resuelta" and por["sin_datos"][0]["inicio"] == T0 + 600
    assert por["reinicio"][0]["estado"] == "activa" and len(por["reinicio"]) == 1


def csv_caja(seq, epoch, eInt=0, tint=310, hint=615, **kw):
    cuerpo, hora = csv(seq, epoch, **kw).rsplit(",", 1)
    return f"{cuerpo},{eInt},{tint},{hint},{hora}"


def _sin_datos(cliente):
    return next(a for a in alertas(cliente, "activa") if a["clave"] == "sin_datos")


def test_sin_datos_distingue_receptora_y_bus_rs485(cliente):
    t = int(time.time())
    # Sin latido no se afirma que el WiFi de la oficina esté caído.
    ingesta(cliente, [{"csv": csv(1, t - 11 * 60)}])
    procesar(cliente, t)
    login(cliente)
    assert _sin_datos(cliente)["mensaje"].startswith("Sin datos desde hace")
    assert "WiFi" not in _sin_datos(cliente)["mensaje"]
    # Latido reciente y lectura vieja: la receptora llega a la nube, la emisora no.
    assert cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1", "ts": t - 40, "rssi_wifi": -55,
                                                  "recibidos": 8, "err_formato": 1}, headers=auth()).status_code == 200
    procesar(cliente, t)
    assert "emisora" in _sin_datos(cliente)["mensaje"] and "en línea" in _sin_datos(cliente)["mensaje"]
    # Lectura al día: la alerta se cierra.
    ingesta(cliente, [{"csv": csv(2, t - 30)}])
    procesar(cliente, t)
    assert not any(a["clave"] == "sin_datos" for a in alertas(cliente, "activa"))


def test_sin_datos_receptora_sin_internet(cliente):
    t = int(time.time())
    ingesta(cliente, [{"csv": csv(1, t - 20 * 60)}])
    assert cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1", "ts": t - 15 * 60, "rssi_wifi": -70,
                                                  "recibidos": 3, "err_formato": 0}, headers=auth()).status_code == 200
    procesar(cliente, t)
    login(cliente)
    assert "WiFi" in _sin_datos(cliente)["mensaje"]


def test_bus_rs485_una_alerta_y_no_si_alguno_responde(cliente):
    e = 0xE2
    ingesta(cliente, [{"csv": csv_caja(1, T0, eA1=e, eA2=e, ePir=e, eS=e, eInt=e)}])
    procesar(cliente, T0 + 30)
    login(cliente)
    claves = {a["clave"] for a in alertas(cliente, "activa")}
    assert "err:bus" in claves
    assert not ({"err:A1", "err:A2", "err:Pir", "err:Suelo"} & claves)
    assert "RS485" in next(a["mensaje"] for a in alertas(cliente, "activa") if a["clave"] == "err:bus")
    # La caja responde: no es el bus entero, vuelven las alertas sueltas.
    ingesta(cliente, [{"csv": csv_caja(2, T0 + 120, eA1=0, eA2=e, ePir=e, eS=e, eInt=0)}])
    procesar(cliente, T0 + 150)
    claves = {a["clave"] for a in alertas(cliente, "activa")}
    assert "err:bus" not in claves and {"err:A2", "err:Pir", "err:Suelo"} <= claves and "err:A1" not in claves
    # Sin campo de caja, los cuatro del bus en timeout bastan.
    ingesta(cliente, [{"csv": csv(3, T0 + 240, eA1=e, eA2=e, ePir=e, eS=e)}])
    procesar(cliente, T0 + 270)
    claves = {a["clave"] for a in alertas(cliente, "activa")}
    assert "err:bus" in claves and not ({"err:A1", "err:A2", "err:Pir", "err:Suelo"} & claves)


def test_alerta_sin_datos_tiempo_real_y_config(cliente):
    t = int(time.time())
    ingesta(cliente, [{"csv": csv(1, t - 3600)}])
    procesar(cliente, t)
    login(cliente)
    assert any(a["clave"] == "sin_datos" for a in alertas(cliente, "activa"))
    assert cliente.get(f"{API}/ultimo").json()["en_linea"] is False
    ingesta(cliente, [{"csv": csv(2, t - 30)}])
    procesar(cliente, t)
    assert not any(a["clave"] == "sin_datos" for a in alertas(cliente, "activa"))
    assert cliente.get(f"{API}/ultimo").json()["en_linea"] is True
    cfg = cliente.get(f"{API}/config").json()
    cfg["nombre_nodo"] = "Casa Sombra 2"
    cfg["umbrales"]["t_aire"] = {"min": 10, "max": 20, "activo": True}
    assert cliente.put(f"{API}/config", json=cfg).status_code == 200
    assert cliente.get(f"{API}/ultimo").json()["nombre_nodo"] == "Casa Sombra 2"
    cfg["umbrales"]["t_aire"] = {"min": 30, "max": 20}
    assert cliente.put(f"{API}/config", json=cfg).status_code == 400
    ingesta(cliente, [{"csv": csv(3, t)}])                                    # 25.5 > 20
    procesar(cliente, t + 1)
    assert any(a["clave"] == "rango:t_aire" for a in alertas(cliente, "activa"))


def test_npk_fallido_y_bateria(cliente):
    ingesta(cliente, [{"csv": csv(1, T0, tipo="C", nnpk=2, edad=32, mn=0)}])
    procesar(cliente, T0 + 60)
    body = {"nodo": "nodo1", "recibidos": 100, "heap": 180000, "cola_pendiente": 12, "firmware": "rx-5.0", "bateria_v": 3.1}
    r = cliente.post(f"{API}/v1/estado", json=body, headers=auth())
    assert r.status_code == 200 and r.json() == {"ok": True, "comandos": [], "cancelados": []}
    assert cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1", "heap": -5}, headers=auth()).status_code == 400
    login(cliente)
    assert cliente.get(f"{API}/ultimo").json()["npk_ultimo_fallo"] is True
    claves = {a["clave"] for a in alertas(cliente)}
    assert {"err:NPK", "bateria"} <= claves


# ---------------------------------------------------------------- historial, agregados y retención
def test_agregacion_historial(cliente):
    t0 = int(time.time()) // 3600 * 3600 - 3 * 3600
    regs = [{"csv": csv(i, t0 + i * 120, t1=200 + i, t2=200 + i, edad=5 + 2 * i, mn=(i % 15) * 2 if i % 15 < 10 else 0)}
            for i in range(60)]
    ingesta(cliente, regs)
    procesar(cliente)
    login(cliente)
    h = cliente.get(f"{API}/historial?var=t_aire&rango=7d").json()
    assert h["paso_s"] == 1800 and sum(p["n"] for p in h["puntos"]) == 60
    for p in h["puntos"]:
        assert p["min"] <= p["prom"] <= p["max"]
    b0 = h["puntos"][0]
    esperado = [20 + i / 10 for i in range(60) if (t0 + i * 120) // 1800 * 1800 == b0["t"]]
    assert abs(b0["prom"] - sum(esperado) / len(esperado)) < 1e-6
    hs = cliente.get(f"{API}/historial?var=t_suelo&rango=24h").json()
    hn = cliente.get(f"{API}/historial?var=n&rango=24h").json()
    assert 0 < sum(p["n"] for p in hs["puntos"]) < 60
    assert sum(p["n"] for p in hn["puntos"]) == 1        # mismo NPK repetido en 60 paquetes => 1 punto
    # 30 d / 1 año salen de agregados horarios (2 h horas completas => promedio ponderado correcto)
    h30 = cliente.get(f"{API}/historial?var=t_aire&rango=30d").json()
    assert h30["fuente"] == "hora" and sum(p["n"] for p in h30["puntos"]) == 60
    tot = sum(p["prom"] * p["n"] for p in h30["puntos"]) / 60
    assert abs(tot - sum(20 + i / 10 for i in range(60)) / 60) < 1e-6
    assert cliente.get(f"{API}/historial?var=zz&rango=24h").status_code == 400
    c = cliente.get(f"{API}/historial.csv?rango=30d")
    assert c.status_code == 200 and c.text.lstrip("\ufeff").startswith("hora_hermosillo,ts,seq")


def test_historial_caja_visible_y_sin_ceros(cliente):
    """La caja interna se consulta como el resto del historial. Un paquete viejo o con eInt 255
    deja un hueco: no entra como 0 °C ni 0 % en la serie, el agregado ni el CSV."""
    t0 = int(time.time()) // 3600 * 3600 - 2 * 3600
    ingesta(cliente, [
        {"csv": csv(1, t0), "id": "caja-sin"},
        {"csv": csv_caja(2, t0 + 600, tint=285, hint=540), "id": "caja-ok"},
        {"csv": csv_caja(3, t0 + 1200, eInt=255, tint=0, hint=0), "id": "caja-vacio"},
    ])
    procesar(cliente)
    login(cliente)
    assert cliente.post(f"{API}/usuarios", json={"usuario": "visorcaja", "clave": "Visor2468ok"}).status_code == 200
    vis = cliente.post(f"{API}/auth/login", json={"usuario": "visorcaja", "clave": "Visor2468ok"})
    hv = {"Authorization": "Bearer " + vis.json()["token"]}
    for headers in (None, hv):
        h = cliente.get(f"{API}/historial?var=t_caja&rango=24h", headers=headers).json()
        assert sum(p["n"] for p in h["puntos"]) == 1
        assert h["puntos"][0]["prom"] == h["puntos"][0]["min"] == h["puntos"][0]["max"] == 28.5
        assert all(p["min"] != 0 and p["prom"] != 0 and p["max"] != 0 for p in h["puntos"])
    hh = cliente.get(f"{API}/historial?var=h_caja&rango=7d", headers=hv).json()
    assert sum(p["n"] for p in hh["puntos"]) == 1 and hh["puntos"][0]["prom"] == 54
    ven = cliente.get(f"{API}/historial?var=t_caja&desde={t0 - 60}&hasta={t0 + 1800}", headers=hv).json()
    assert sum(p["n"] for p in ven["puntos"]) == 1 and ven["puntos"][0]["prom"] == 28.5
    h30 = cliente.get(f"{API}/historial?var=t_caja&rango=30d", headers=hv).json()
    assert h30["fuente"] == "hora" and sum(p["n"] for p in h30["puntos"]) == 1 and h30["puntos"][0]["prom"] == 28.5
    rep = cliente.get(f"{API}/reporte?rango=24h", headers=hv).json()
    assert rep["variables"]["t_caja"]["nombre"] == "Temp. caja"
    assert rep["variables"]["h_caja"]["nombre"] == "Hum. caja"
    assert rep["variables"]["t_caja"]["resumen"]["n"] == 1
    assert rep["variables"]["t_caja"]["resumen"]["prom"] == 28.5
    k = cx(cliente)
    agr = k.uno("SELECT prom, vmin, vmax, n FROM estacion_agregados_hora WHERE var = 't_caja'")
    assert agr["n"] == 1 and abs(agr["prom"] - 28.5) < 1e-6 and agr["vmin"] == 28.5
    k.s.close()
    crudo = cliente.get(f"{API}/historial.csv?rango=24h", headers=hv)
    assert crudo.status_code == 200
    import csv as csvmod
    import io
    filas = list(csvmod.reader(io.StringIO(crudo.text.lstrip("\ufeff"))))
    cab = filas[0]
    i_t, i_h = cab.index("t_int"), cab.index("h_int")
    tint = [float(f[i_t]) if f[i_t] else None for f in filas[1:]]
    hint = [float(f[i_h]) if f[i_h] else None for f in filas[1:]]
    assert tint.count(28.5) == 1 and tint.count(None) == 2 and 0.0 not in tint
    assert hint.count(54.0) == 1 and hint.count(None) == 2 and 0.0 not in hint


def test_retencion_conserva_agregados(cliente):
    from estacion.ajustes import ajustes
    t0 = int(time.time()) - 20 * 86400
    ingesta(cliente, [{"csv": csv(i, t0 + i * 120)} for i in range(30)])
    procesar(cliente)
    k = cx(cliente)
    n_agr = k.uno("SELECT COUNT(*) AS n FROM estacion_agregados_hora WHERE var = 't_aire'")["n"]
    ajustes.retencion_dias = 10
    try:
        sv.purgar(k)
        k.commit()
    finally:
        ajustes.retencion_dias = 30
    assert k.uno("SELECT COUNT(*) AS n FROM estacion_lecturas")["n"] == 0
    assert k.uno("SELECT COUNT(*) AS n FROM estacion_agregados_hora WHERE var = 't_aire'")["n"] == n_agr > 0
    k.s.close()


def test_tope_de_disco(cliente):
    from estacion.ajustes import ajustes
    t0 = int(time.time()) - 5 * 86400
    for b in range(0, 2000, 200):
        ingesta(cliente, [{"csv": csv(i % 65536, t0 + i * 120)} for i in range(b, b + 200)])
    procesar(cliente)
    k = cx(cliente)
    antes = k.uno("SELECT COUNT(*) AS n FROM estacion_lecturas")["n"]
    mb = sv.tamano_mb(k)
    assert mb > 0
    ajustes.max_mb = mb / 2
    try:
        _, borradas = sv.controlar_disco(k)
        k.commit()
    finally:
        ajustes.max_mb = 150
    despues = k.uno("SELECT COUNT(*) AS n FROM estacion_lecturas")["n"]
    assert borradas >= 1000 and despues == antes - borradas
    assert k.uno("SELECT MIN(ts) AS m FROM estacion_lecturas")["m"] > t0          # se borró lo más antiguo
    assert k.uno("SELECT COUNT(*) AS n FROM estacion_alertas WHERE clave = 'disco' AND estado = 'activa'")["n"] == 1
    k.s.close()


# ---------------------------------------------------------------- comandos OTA
def test_flujo_comando_ota(cliente):
    login(cliente)
    assert cliente.post(f"{API}/comandos", json={"duracion_min": 3}).status_code == 400
    assert cliente.post(f"{API}/comandos", json={"duracion_min": 45}).status_code == 400
    c = cliente.post(f"{API}/comandos", json={"duracion_min": 20}).json()["comando"]
    assert c["estado"] == "pendiente"
    assert cliente.post(f"{API}/comandos", json={"duracion_min": 15}).status_code == 409
    r = ingesta(cliente, [{"csv": csv(1, T0)}]).json()
    assert r["comandos"] == [{"id": c["id"], "tipo": "ota", "duracion_min": 20}]
    assert cliente.get(f"{API}/comandos").json()["comandos"][0]["estado"] == "entregado_receptora"
    assert ingesta(cliente, [{"csv": csv(2, T0 + 120)}]).json()["comandos"] == []
    assert cliente.post(f"{API}/v1/estado", json={"nodo": "nodo1"}, headers=auth()).json()["comandos"] == []
    u = f"{API}/v1/comandos/{c['id']}/estado"
    assert cliente.post(u, json={"estado": "completado"}, headers=auth()).status_code == 409
    assert cliente.post(u, json={"estado": "raro"}, headers=auth()).status_code == 400
    assert cliente.post(u, json={"estado": "enviado_emisora", "detalle": "LoRa ok"}, headers=auth()).status_code == 200
    assert cliente.post(u, json={"estado": "entregado_receptora"}, headers=auth()).status_code == 400
    assert cliente.post(u, json={"estado": "activo", "detalle": "AP listo"}, headers=auth()).status_code == 200
    assert cliente.post(f"{API}/comandos/{c['id']}/cancelar").status_code == 409
    assert cliente.post(u, json={"estado": "completado", "detalle": "fin"}, headers=auth()).status_code == 200
    assert cliente.post(u, json={"estado": "activo"}, headers=auth()).status_code == 409
    assert cliente.post(f"{API}/v1/comandos/9999/estado", json={"estado": "activo"}, headers=auth()).status_code == 404
    al = [a for a in alertas(cliente) if a["tipo"] == "comando"]
    assert al and al[0]["estado"] == "resuelta" and "completado" in al[0]["mensaje"]


def test_comando_cancelar_expirar_reentregar(cliente):
    login(cliente)
    c = cliente.post(f"{API}/comandos", json={"duracion_min": 15}).json()["comando"]
    assert cliente.post(f"{API}/comandos/{c['id']}/cancelar").json()["comando"]["estado"] == "cancelado"
    assert ingesta(cliente, [{"csv": csv(1, T0)}]).json()["comandos"] == []
    c2 = cliente.post(f"{API}/comandos", json={"duracion_min": 10}).json()["comando"]
    k = cx(cliente)
    assert sv.comandos_para_entrega(k, "nodo1", c2["creado"])["comandos"][0]["id"] == c2["id"]
    assert sv.comandos_para_entrega(k, "nodo1", c2["creado"] + 60)["comandos"] == []
    assert sv.comandos_para_entrega(k, "nodo1", c2["creado"] + 301)["comandos"][0]["id"] == c2["id"]   # reentrega
    sv.expirar_comandos(k, c2["creado"] + 3601)
    k.commit()
    k.s.close()
    assert cliente.get(f"{API}/comandos").json()["comandos"][0]["estado"] == "expirado"
    r = cliente.post(f"{API}/v1/comandos/{c2['id']}/estado", json={"estado": "activo"}, headers=auth())
    assert r.status_code == 409 and r.json()["estado"] == "expirado"


# ---------------------------------------------------------------- simulador completo
def test_simulador_7_dias(cliente):
    from estacion.ajustes import ajustes
    ajustes.rate_por_min = 1000
    regs = simulador.generar(7)
    tot = {"aceptados": 0, "duplicados": 0}
    for i in range(0, len(regs), 200):
        j = ingesta(cliente, regs[i:i + 200]).json()
        tot["aceptados"] += j["aceptados"]
        tot["duplicados"] += j["duplicados"]
    j = ingesta(cliente, regs[:200]).json()
    ajustes.rate_por_min = 30
    assert j["aceptados"] == 0 and j["duplicados"] == 200
    assert tot["aceptados"] + tot["duplicados"] == len(regs) and tot["duplicados"] > 0
    procesar(cliente)
    login(cliente)
    al = alertas(cliente)
    assert {"err:A2", "err:Pir", "err:Suelo", "err:NPK", "sin_datos", "reinicio"} <= {a["clave"] for a in al}
    assert len([a for a in al if a["clave"] == "reinicio"]) == 1
