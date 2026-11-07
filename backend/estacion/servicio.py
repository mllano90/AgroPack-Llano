"""Lógica de negocio: ingesta idempotente, alertas, comandos remotos y consultas."""
import json
import os
import re
import time

from . import config as cfgmod
from .ajustes import ajustes
from .paquete import PaqueteInvalido, decodificar, parsear, texto_error

RE_NODO = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
SALTO_MAX_SEQ = 1000
VENTANA_SUELO_S = 50
VENTANA_NPK_S = 150
VENTANA_DUP_SIN_HORA_S = 60

ESTADOS_CMD = ["pendiente", "entregado_receptora", "enviado_emisora", "activo",
               "completado", "expirado", "fallido", "cancelado"]
TERMINALES = {"completado", "expirado", "fallido", "cancelado"}
REPORTABLES = {"enviado_emisora", "activo", "completado", "expirado", "fallido"}
ORDEN = {e: i for i, e in enumerate(ESTADOS_CMD)}
EXPIRA_SIN_ACTIVO_S = 3600
REENTREGA_S = 300
TEXTO_CMD = {
    "pendiente": "pendiente (esperando a la receptora)",
    "entregado_receptora": "entregado a la receptora",
    "enviado_emisora": "enviado a la emisora por LoRa",
    "activo": "ACTIVO: emisora con AP + OTA listo",
    "completado": "completado", "expirado": "expirado", "fallido": "fallido", "cancelado": "cancelado",
}


def ahora() -> int:
    return int(time.time())


# ============================================================ alertas
def alerta_abrir(cx, nodo, clave, tipo, mensaje, valor, ts):
    a = cx.uno("SELECT id FROM estacion_alertas WHERE nodo = ? AND clave = ? AND estado = 'activa'", (nodo, clave))
    if a:
        cx.ejecutar("UPDATE estacion_alertas SET ultima = ?, conteo = conteo + 1, valor = ?, mensaje = ? WHERE id = ?",
                    (ts, valor, mensaje, a["id"]))
        return a["id"]
    cx.ejecutar("INSERT INTO estacion_alertas (nodo, clave, tipo, mensaje, valor, estado, inicio, ultima) "
                "VALUES (?, ?, ?, ?, ?, 'activa', ?, ?)", (nodo, clave, tipo, mensaje, valor, ts, ts))
    return cx.uno("SELECT MAX(id) AS id FROM estacion_alertas WHERE nodo = ? AND clave = ?", (nodo, clave))["id"]


def alerta_resolver(cx, nodo, clave, ts):
    cx.ejecutar("UPDATE estacion_alertas SET estado = 'resuelta', fin = ? WHERE nodo = ? AND clave = ? AND estado = 'activa'",
                (ts, nodo, clave))


def alerta_evento(cx, nodo, clave, tipo, mensaje, ts, estado="activa", valor=None):
    cx.ejecutar("INSERT INTO estacion_alertas (nodo, clave, tipo, mensaje, valor, estado, inicio, ultima, fin) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (nodo, clave, tipo, mensaje, valor, estado, ts, ts, ts if estado == "resuelta" else None))
    return cx.uno("SELECT MAX(id) AS id FROM estacion_alertas WHERE nodo = ? AND clave = ?", (nodo, clave))["id"]


def _prom(a, b):
    v = [x for x in (a, b) if x is not None]
    return sum(v) / len(v) if v else None


def valores_para_rango(r):
    """Valor por variable para comparar con umbrales (None = no evaluar en este registro)."""
    v = {"pir": r["pir"], "t_aire": _prom(r["t1"], r["t2"]), "h_aire": _prom(r["h1"], r["h2"])}
    if r["suelo_nuevo"]:
        v.update(t_suelo=r["t_suelo"], h_suelo=r["h_suelo"])
    if r["npk_nuevo"]:
        v.update(ph=r["ph"], ec=r["ec"], n=r["n"], p=r["p"], k=r["k"])
    return v


def evaluar_registro(cx, cfg, nodo, r, ev, t_servidor):
    """Evalúa alertas para un registro nuevo en orden cronológico. ev = fila nodo_eval o None."""
    ts = r["ts"]
    lim = cfg["sin_datos_min"] * 60
    if ev:
        hueco = ts - ev["ultimo_ts"]
        activa = cx.uno("SELECT id FROM estacion_alertas WHERE nodo = ? AND clave = 'sin_datos' AND estado = 'activa'", (nodo,))
        if activa:
            if t_servidor - ts <= lim:          # los datos vuelven a estar al día
                alerta_resolver(cx, nodo, "sin_datos", ts)
        elif hueco > lim:                        # hueco histórico (llegó por reenvío de la cola)
            cx.ejecutar("INSERT INTO estacion_alertas (nodo, clave, tipo, mensaje, valor, estado, inicio, ultima, fin) "
                        "VALUES (?, 'sin_datos', 'sin_datos', ?, ?, 'resuelta', ?, ?, ?)",
                        (nodo, f"Sin datos durante {hueco // 60} min", hueco / 60, ev["ultimo_ts"], ts, ts))
        d = (r["seq"] - ev["ultimo_seq"]) & 0xFFFF
        if d != 0 and (d > SALTO_MAX_SEQ or (r["seq"] == 0 and ev["ultimo_seq"] != 65535)):
            cx.ejecutar("UPDATE estacion_lecturas SET reinicio = 1 WHERE uid = ?", (r["uid"],))
            alerta_evento(cx, nodo, "reinicio", "reinicio",
                          f"Reinicio de la emisora detectado (seq {ev['ultimo_seq']} → {r['seq']})", ts)
    for clave, cod, nombre in (("err:A1", r["e_a1"], "Aire 1"), ("err:A2", r["e_a2"], "Aire 2"),
                               ("err:Pir", r["e_pir"], "Piranómetro"), ("err:Suelo", r["e_suelo"], "Sensor de suelo T/H")):
        if cod != 0:
            alerta_abrir(cx, nodo, clave, "error_sensor", f"{nombre}: {texto_error(cod)}", cod, ts)
        else:
            alerta_resolver(cx, nodo, clave, ts)
    if r["tipo"] == "C":
        if r["npk_fallo"]:
            alerta_abrir(cx, nodo, "err:NPK", "error_sensor",
                         f"Muestreo NPK fallido ({r['n_npk']}/6 lecturas válidas)", r["n_npk"], ts)
        else:
            alerta_resolver(cx, nodo, "err:NPK", ts)
    for var, val in valores_para_rango(r).items():
        u = cfg["umbrales"].get(var)
        if val is None or not u:
            continue
        nombre, unidad = cfgmod.VARIABLES[var][0], cfgmod.VARIABLES[var][1]
        if u.get("activo", True) and (val < u["min"] or val > u["max"]):
            lado = "bajo" if val < u["min"] else "alto"
            alerta_abrir(cx, nodo, f"rango:{var}", "fuera_rango",
                         f"{nombre} {lado}: {val:g} {unidad} (rango {u['min']:g}–{u['max']:g})", val, ts)
        else:
            alerta_resolver(cx, nodo, f"rango:{var}", ts)


def revisar_sin_datos(cx, t=None):
    """Tarea periódica: alerta 'sin datos' en tiempo real + expiración de comandos."""
    t = t or ahora()
    cfg = cfgmod.leer(cx)
    for ev in cx.todos("SELECT nodo, ultimo_ts FROM estacion_nodo_eval"):
        mins = (t - ev["ultimo_ts"]) // 60
        if t - ev["ultimo_ts"] > cfg["sin_datos_min"] * 60:
            alerta_abrir(cx, ev["nodo"], "sin_datos", "sin_datos", f"Sin datos desde hace {mins} min", mins,
                         ev["ultimo_ts"])
            cx.ejecutar("UPDATE estacion_alertas SET ultima = ? WHERE nodo = ? AND clave = 'sin_datos' AND estado = 'activa'",
                        (t, ev["nodo"]))
    expirar_comandos(cx, t)


# ============================================================ ingesta
def _entero(x, nombre, lo, hi, requerido=False):
    if x is None:
        if requerido:
            raise PaqueteInvalido(f"falta {nombre}")
        return None
    if isinstance(x, bool) or not isinstance(x, (int, float)) or int(x) != x:
        raise PaqueteInvalido(f"{nombre} debe ser entero")
    if not lo <= x <= hi:
        raise PaqueteInvalido(f"{nombre} fuera de rango")
    return int(x)


def validar_registro(reg, nodo, t_servidor):
    if not isinstance(reg, dict):
        raise PaqueteInvalido("el registro debe ser un objeto")
    p = parsear(reg.get("csv"))
    rssi = _entero(reg.get("rssi"), "rssi", -200, 50)
    snr = reg.get("snr")
    if snr is not None and (isinstance(snr, bool) or not isinstance(snr, (int, float)) or not -50 <= snr <= 50):
        raise PaqueteInvalido("snr inválido")
    rx = _entero(reg.get("rx", 0), "rx", 0, 4102444800) or 0
    if rx and rx < 1704067200:
        raise PaqueteInvalido("rx (epoch de recepción) anterior a 2024")
    rid = reg.get("id")
    if rid is not None and (not isinstance(rid, (str, int)) or len(str(rid)) > 64 or str(rid) == ""):
        raise PaqueteInvalido("id inválido")
    ts = p["epoch"] or rx or t_servidor
    if rid is not None:
        uid = f"{nodo}:id:{rid}"
    elif p["epoch"]:
        uid = f"{nodo}:{p['seq']}:{p['epoch']}"
    elif rx:
        uid = f"{nodo}:{p['seq']}:rx{rx}"
    else:   # ni la emisora ni la receptora tienen hora: el texto exacto + rssi/snr identifica el reenvío
        import hashlib
        uid = f"{nodo}:{p['seq']}:h" + hashlib.sha1(f"{reg.get('csv')}|{rssi}|{snr}".encode()).hexdigest()[:16]
    d = decodificar(p, ts)
    fila = {"uid": uid, "nodo": nodo, "tipo": p["tipo"], "seq": p["seq"], "ts": ts, "ts_emisora": p["epoch"],
            "ts_rx": rx or None, "ts_servidor": t_servidor, "rssi": rssi, "snr": float(snr) if snr is not None else None,
            "e_a1": p["e_a1"], "t1": d["t1"], "h1": d["h1"], "e_a2": p["e_a2"], "t2": d["t2"], "h2": d["h2"],
            "e_int": d["e_int"], "t_int": d["t_int"], "h_int": d["h_int"],
            "e_pir": p["e_pir"], "pir": d["pir"], "e_suelo": p["e_suelo"], "h_suelo": d["h_suelo"],
            "t_suelo": d["t_suelo"], "ts_suelo": d["ts_suelo"], "suelo_nuevo": 0,
            "ec": d["ec"], "ph": d["ph"], "n": d["n"], "p": d["p"], "k": d["k"], "n_npk": p["n_npk"],
            "edad_npk": p["edad_npk"], "ts_npk": d["ts_npk"], "npk_nuevo": 0, "fase": p["fase"],
            "min_fase": p["min_fase"], "tot_fase": p["tot_fase"], "csv": reg["csv"].rstrip("\r\n")}
    fila["_npk_fallo"] = d["npk_fallo"]
    return fila


COLS = ["uid", "nodo", "tipo", "seq", "ts", "ts_emisora", "ts_rx", "ts_servidor", "rssi", "snr", "e_a1", "t1", "h1",
        "e_a2", "t2", "h2", "e_int", "t_int", "h_int", "e_pir", "pir", "e_suelo", "h_suelo", "t_suelo", "ts_suelo",
        "suelo_nuevo", "ec", "ph", "n", "p", "k", "n_npk", "edad_npk", "ts_npk", "npk_nuevo", "fase", "min_fase",
        "tot_fase", "csv"]
SQL_INSERT = (f"INSERT INTO estacion_lecturas ({', '.join(COLS)}) VALUES ({', '.join('?' * len(COLS))}) "
              "ON CONFLICT (uid) DO NOTHING")


def ingestar(cx, cuerpo, t_servidor=None):
    """Devuelve (http_status, respuesta)."""
    t_servidor = t_servidor or ahora()
    if not isinstance(cuerpo, dict):
        return 400, {"ok": False, "error": "el cuerpo debe ser un objeto JSON"}
    nodo = cuerpo.get("nodo")
    if not isinstance(nodo, str) or not RE_NODO.match(nodo):
        return 400, {"ok": False, "error": "nodo inválido (1-32 caracteres A-Z a-z 0-9 _ -)"}
    regs = cuerpo.get("registros")
    if not isinstance(regs, list):
        return 400, {"ok": False, "error": "registros debe ser una lista"}
    if len(regs) > ajustes.max_lote:
        return 413, {"ok": False, "error": f"máximo {ajustes.max_lote} registros por lote"}
    validos, rechazados = [], []
    for i, reg in enumerate(regs):
        try:
            validos.append((i, validar_registro(reg, nodo, t_servidor)))
        except (PaqueteInvalido, ValueError, TypeError) as e:
            rechazados.append({"i": i, "error": str(e)})
    aceptados, duplicados, ultimo_id = 0, 0, None
    limite_viejo = t_servidor - ajustes.retencion_dias * 86400
    for i, f in validos:
        f.pop("_npk_fallo")
        if f["ts"] < limite_viejo:
            rechazados.append({"i": i, "error": f"más viejo que la retención ({ajustes.retencion_dias} días)"})
            continue
        if f["ts_emisora"] == 0 and cx.uno(       # duplicado LoRa sin hora: misma trama recibida segundos antes
                "SELECT 1 AS x FROM estacion_lecturas WHERE nodo = ? AND seq = ? AND ts_emisora = 0 AND csv = ? "
                "AND ts BETWEEN ? AND ?",
                (nodo, f["seq"], f["csv"], f["ts"] - VENTANA_DUP_SIN_HORA_S, f["ts"] + VENTANA_DUP_SIN_HORA_S)):
            duplicados += 1
            continue
        if cx.ejecutar(SQL_INSERT, tuple(f[c] for c in COLS)) == 1:
            aceptados += 1
        else:
            duplicados += 1
        ultimo_id = f["uid"]
    rechazados.sort(key=lambda x: x["i"])
    resp = {"ok": bool(validos) or not regs, "aceptados": aceptados, "duplicados": duplicados,
            "ultimo_id": ultimo_id, "rechazados": rechazados}
    resp.update(comandos_para_entrega(cx, nodo, t_servidor))
    if regs and not validos:
        resp["error"] = "ningún registro válido"
        return 400, resp
    return 200, resp


CAMPOS_ESTADO = {"recibidos": 0, "perdidos": 0, "duplicados": 0, "reinicios_emisora": 0, "err_crc": 0,
                 "err_formato": 0, "radio_reinit": 0, "heap": 0, "heap_min": 0, "cola_pendiente": 0, "uptime_s": 0}


def registrar_estado(cx, cuerpo, t_servidor=None):
    t_servidor = t_servidor or ahora()
    if not isinstance(cuerpo, dict):
        return 400, {"ok": False, "error": "el cuerpo debe ser un objeto JSON"}
    nodo = cuerpo.get("nodo")
    if not isinstance(nodo, str) or not RE_NODO.match(nodo):
        return 400, {"ok": False, "error": "nodo inválido"}
    vals = {}
    try:
        for k in CAMPOS_ESTADO:
            vals[k] = _entero(cuerpo.get(k), k, 0, 2 ** 53)
        fw = cuerpo.get("firmware")
        if fw is not None and (not isinstance(fw, str) or len(fw) > 40):
            raise PaqueteInvalido("firmware inválido")
        bat = cuerpo.get("bateria_v")
        if bat is not None and (isinstance(bat, bool) or not isinstance(bat, (int, float)) or not 0 <= bat <= 30):
            raise PaqueteInvalido("bateria_v inválido")
        rw = _entero(cuerpo.get("rssi_wifi"), "rssi_wifi", -150, 10)
        ts = _entero(cuerpo.get("ts", 0), "ts", 0, 4102444800) or t_servidor
    except PaqueteInvalido as e:
        return 400, {"ok": False, "error": str(e)}
    cx.ejecutar("INSERT INTO estacion_estado_receptora (nodo, ts, recibidos, perdidos, duplicados, reinicios_emisora, err_crc, "
                "err_formato, radio_reinit, heap, heap_min, cola_pendiente, firmware, uptime_s, bateria_v, rssi_wifi) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (nodo, ts, vals["recibidos"], vals["perdidos"], vals["duplicados"], vals["reinicios_emisora"],
                 vals["err_crc"], vals["err_formato"], vals["radio_reinit"], vals["heap"], vals["heap_min"],
                 vals["cola_pendiente"], fw, vals["uptime_s"], bat, rw))
    if bat is not None:   # placeholder batería (futuro)
        cfg = cfgmod.leer(cx)
        if bat < cfg["bateria_min_v"]:
            alerta_abrir(cx, nodo, "bateria", "bateria", f"Batería baja: {bat:.2f} V", bat, t_servidor)
        else:
            alerta_resolver(cx, nodo, "bateria", t_servidor)
    resp = {"ok": True}
    resp.update(comandos_para_entrega(cx, nodo, t_servidor))
    return 200, resp


# ============================================================ comandos remotos
def _cmd_publico(c):
    par = json.loads(c["parametros"])
    return {"id": c["id"], "nodo": c["nodo"], "tipo": c["tipo"], "parametros": par, "estado": c["estado"],
            "estado_texto": TEXTO_CMD.get(c["estado"], c["estado"]), "creado": c["creado"],
            "actualizado": c["actualizado"], "detalle": c["detalle"], "usuario": c["usuario"],
            "expira": c["creado"] + EXPIRA_SIN_ACTIVO_S if ORDEN[c["estado"]] < ORDEN["activo"] else None}


def _cmd_alerta(cx, c, t):
    par = json.loads(c["parametros"])
    msg = f"Comando #{c['id']} modo programación ({par.get('duracion_min')} min): {TEXTO_CMD[c['estado']]}"
    if c.get("detalle"):
        msg += f" — {c['detalle']}"
    if c["estado"] in TERMINALES:
        cx.ejecutar("UPDATE estacion_alertas SET mensaje = ?, ultima = ?, estado = 'resuelta', fin = ? WHERE id = ?",
                    (msg, t, t, c["alerta_id"]))
    else:
        cx.ejecutar("UPDATE estacion_alertas SET mensaje = ?, ultima = ? WHERE id = ?", (msg, t, c["alerta_id"]))


def _cmd_cambiar(cx, c, estado, detalle, t):
    cx.ejecutar("UPDATE estacion_comandos SET estado = ?, detalle = ?, actualizado = ? WHERE id = ?",
                (estado, detalle, t, c["id"]))
    c = dict(c, estado=estado, detalle=detalle, actualizado=t)
    _cmd_alerta(cx, c, t)
    return c


def crear_comando(cx, nodo, tipo, parametros, usuario, t=None):
    t = t or ahora()
    if tipo != "ota":
        raise ValueError("tipo de comando no soportado (solo 'ota')")
    dur = parametros.get("duracion_min", 15)
    if isinstance(dur, bool) or not isinstance(dur, int) or not 5 <= dur <= 30:
        raise ValueError("duracion_min debe ser entero entre 5 y 30")
    if not isinstance(nodo, str) or not RE_NODO.match(nodo):
        raise ValueError("nodo inválido")
    expirar_comandos(cx, t)
    abiertos = cx.todos("SELECT id FROM estacion_comandos WHERE nodo = ? AND estado NOT IN "
                        "('completado','expirado','fallido','cancelado')", (nodo,))
    if abiertos:
        raise LookupError(f"ya hay un comando en curso (#{abiertos[0]['id']})")
    par = json.dumps({"duracion_min": dur})
    cx.ejecutar("INSERT INTO estacion_comandos (nodo, tipo, parametros, estado, creado, actualizado, usuario) "
                "VALUES (?, ?, ?, 'pendiente', ?, ?, ?)", (nodo, tipo, par, t, t, usuario))
    c = cx.uno("SELECT * FROM estacion_comandos WHERE id = (SELECT MAX(id) FROM estacion_comandos WHERE nodo = ?)", (nodo,))
    aid = alerta_evento(cx, nodo, f"cmd:{c['id']}", "comando", "…", t)
    cx.ejecutar("UPDATE estacion_comandos SET alerta_id = ? WHERE id = ?", (aid, c["id"]))
    c["alerta_id"] = aid
    _cmd_alerta(cx, c, t)
    return _cmd_publico(c)


def comandos_para_entrega(cx, nodo, t):
    """Lista 'comandos' para la respuesta de ingesta/estado. Marca entregado_receptora.
    Se reentrega un comando entregado_receptora si pasan REENTREGA_S sin avance (respuesta perdida)."""
    expirar_comandos(cx, t)
    filas = cx.todos("SELECT * FROM estacion_comandos WHERE nodo = ? AND (estado = 'pendiente' OR "
                     "(estado = 'entregado_receptora' AND actualizado <= ?)) ORDER BY id", (nodo, t - REENTREGA_S))
    out = []
    for c in filas:
        par = json.loads(c["parametros"])
        out.append({"id": c["id"], "tipo": c["tipo"], "duracion_min": par.get("duracion_min")})
        _cmd_cambiar(cx, c, "entregado_receptora", c["detalle"], t)
    cancel = cx.todos("SELECT id FROM estacion_comandos WHERE nodo = ? AND estado = 'cancelado' AND actualizado >= ? "
                      "AND detalle LIKE 'cancelado tras entrega%'", (nodo, t - EXPIRA_SIN_ACTIVO_S))
    return {"comandos": out, "cancelados": [c["id"] for c in cancel]}


def reportar_comando(cx, cid, cuerpo, t=None):
    t = t or ahora()
    if not isinstance(cuerpo, dict) or cuerpo.get("estado") not in REPORTABLES:
        return 400, {"ok": False, "error": "estado debe ser uno de: " + ", ".join(sorted(REPORTABLES))}
    detalle = cuerpo.get("detalle")
    if detalle is not None and not isinstance(detalle, str):
        return 400, {"ok": False, "error": "detalle debe ser texto"}
    detalle = (detalle or "")[:300] or None
    expirar_comandos(cx, t)
    c = cx.uno("SELECT * FROM estacion_comandos WHERE id = ?", (cid,))
    if not c:
        return 404, {"ok": False, "error": "comando no existe"}
    nuevo = cuerpo["estado"]
    if c["estado"] in TERMINALES:
        return 409, {"ok": False, "error": f"el comando ya está {c['estado']}", "estado": c["estado"]}
    if ORDEN[nuevo] < ORDEN[c["estado"]] or (nuevo == c["estado"] and nuevo != "activo"):
        return 409, {"ok": False, "error": f"transición inválida {c['estado']} -> {nuevo}", "estado": c["estado"]}
    if nuevo == "completado" and c["estado"] != "activo":
        return 409, {"ok": False, "error": "completado requiere estado activo previo", "estado": c["estado"]}
    c = _cmd_cambiar(cx, c, nuevo, detalle, t)
    return 200, {"ok": True, "id": cid, "estado": nuevo}


def cancelar_comando(cx, cid, t=None):
    t = t or ahora()
    expirar_comandos(cx, t)
    c = cx.uno("SELECT * FROM estacion_comandos WHERE id = ?", (cid,))
    if not c:
        return 404, {"ok": False, "error": "comando no existe"}
    if c["estado"] not in ("pendiente", "entregado_receptora"):
        return 409, {"ok": False, "error": f"no se puede cancelar: estado {c['estado']}"}
    det = "cancelado por el usuario" if c["estado"] == "pendiente" else "cancelado tras entrega a la receptora"
    c = _cmd_cambiar(cx, c, "cancelado", det, t)
    return 200, {"ok": True, "comando": _cmd_publico(c)}


def expirar_comandos(cx, t):
    for c in cx.todos("SELECT * FROM estacion_comandos WHERE estado IN ('pendiente','entregado_receptora','enviado_emisora') "
                      "AND creado <= ?", (t - EXPIRA_SIN_ACTIVO_S,)):
        _cmd_cambiar(cx, c, "expirado", "sin confirmación 'activo' en 60 min", t)
    for c in cx.todos("SELECT * FROM estacion_comandos WHERE estado = 'activo'"):
        dur = json.loads(c["parametros"]).get("duracion_min", 15)
        if t - c["actualizado"] > (dur + 30) * 60:
            _cmd_cambiar(cx, c, "expirado", "sin aviso de fin tras la ventana OTA", t)


def listar_comandos(cx, nodo, limite=20):
    return [_cmd_publico(c) for c in cx.todos("SELECT * FROM estacion_comandos WHERE nodo = ? ORDER BY id DESC LIMIT ?",
                                              (nodo, limite))]


# ============================================================ consultas UI
def nodo_actual(cx):
    r = cx.uno("SELECT nodo FROM estacion_nodo_eval ORDER BY ultimo_ts DESC LIMIT 1") or \
        cx.uno("SELECT nodo FROM estacion_lecturas ORDER BY id DESC LIMIT 1")
    return r["nodo"] if r else "nodo1"


def ultimo(cx, nodo, t=None):
    t = t or ahora()
    cfg = cfgmod.leer(cx)
    r = cx.uno("SELECT * FROM estacion_lecturas WHERE nodo = ? ORDER BY ts DESC, id DESC LIMIT 1", (nodo,))
    n_alertas = cx.uno("SELECT COUNT(*) AS n FROM estacion_alertas WHERE nodo = ? AND estado = 'activa'", (nodo,))["n"]
    est = cx.uno("SELECT * FROM estacion_estado_receptora WHERE nodo = ? ORDER BY ts DESC, id DESC LIMIT 1", (nodo,))
    if est:
        est.pop("json", None)
    base = {"nodo": nodo, "nombre_nodo": cfg["nombre_nodo"], "ahora": t, "alertas_activas": n_alertas,
            "offline_min": cfg["offline_min"], "receptora": est, "umbrales": cfg["umbrales"]}
    if not r:
        return dict(base, hay_datos=False, en_linea=False)
    sensor = lambda e, **v: {"ok": e == 0, "error": None if e == 0 else texto_error(e), "codigo": e, **v}
    a1 = sensor(r["e_a1"], t=r["t1"], h=r["h1"])
    a2 = sensor(r["e_a2"], t=r["t2"], h=r["h2"])
    npk = None
    if r["ts_npk"] is not None:
        npk = {"ec": r["ec"], "ph": r["ph"], "n": r["n"], "p": r["p"], "k": r["k"], "ts": r["ts_npk"],
               "n_npk": r["n_npk"]}
    ult_c = cx.uno("SELECT ts, n_npk FROM estacion_lecturas WHERE nodo = ? AND tipo = 'C' ORDER BY ts DESC LIMIT 1", (nodo,))
    return dict(base, hay_datos=True, en_linea=(t - r["ts"]) <= cfg["offline_min"] * 60,
                ts=r["ts"], ts_servidor=r["ts_servidor"], sin_hora_emisora=r["ts_emisora"] == 0, seq=r["seq"],
                tipo=r["tipo"], rssi=r["rssi"], snr=r["snr"],
                aire={"a1": a1, "a2": a2, "t": _prom(r["t1"], r["t2"]), "h": _prom(r["h1"], r["h2"])},
                interno=None if r.get("e_int") is None else sensor(r["e_int"], t=r["t_int"], h=r["h_int"]),
                pir=sensor(r["e_pir"], v=r["pir"]),
                suelo=sensor(r["e_suelo"], t=r["t_suelo"], h=r["h_suelo"], ts=r["ts_suelo"]),
                npk=npk, npk_ultimo_fallo=bool(ult_c and ult_c["n_npk"] < 3),
                fase={"fase": r["fase"], "min": r["min_fase"], "tot": r["tot_fase"]})


VARS_HIST = {
    # var: (expresión SQL, columna de tiempo, filtro extra)
    "pir": ("pir", "ts", ""),
    "t_aire": ("CASE WHEN t1 IS NOT NULL AND t2 IS NOT NULL THEN (t1 + t2) / 2 ELSE COALESCE(t1, t2) END", "ts", ""),
    "h_aire": ("CASE WHEN h1 IS NOT NULL AND h2 IS NOT NULL THEN (h1 + h2) / 2 ELSE COALESCE(h1, h2) END", "ts", ""),
    "t1": ("t1", "ts", ""), "t2": ("t2", "ts", ""), "h1": ("h1", "ts", ""), "h2": ("h2", "ts", ""),
    "t_suelo": ("t_suelo", "ts_suelo", "AND suelo_nuevo = 1"),
    "h_suelo": ("h_suelo", "ts_suelo", "AND suelo_nuevo = 1"),
    "ph": ("ph", "ts_npk", "AND npk_nuevo = 1"), "ec": ("ec", "ts_npk", "AND npk_nuevo = 1"),
    "n": ("n", "ts_npk", "AND npk_nuevo = 1"), "p": ("p", "ts_npk", "AND npk_nuevo = 1"),
    "k": ("k", "ts_npk", "AND npk_nuevo = 1"),
    "rssi": ("rssi", "ts", ""), "snr": ("snr", "ts", ""),
}
RANGOS = {   # rango: (duración s, paso s, fuente)
    "24h": (86400, 300, "crudo"), "7d": (7 * 86400, 1800, "crudo"), "30d": (30 * 86400, 7200, "hora"),
    "90d": (90 * 86400, 21600, "hora"), "365d": (365 * 86400, 86400, "hora"),
}


def historial(cx, nodo, var, rango, t=None):
    t = t or ahora()
    if var not in VARS_HIST or rango not in RANGOS:
        raise ValueError("variable o rango inválido")
    dur, paso, fuente = RANGOS[rango]
    desde = t - dur
    if fuente == "crudo":
        expr, tcol, filtro = VARS_HIST[var]
        filas = cx.todos(
            f"SELECT ({tcol} / ?) * ? AS b, AVG({expr}) AS prom, MIN({expr}) AS mn, MAX({expr}) AS mx, COUNT(*) AS n "
            f"FROM estacion_lecturas WHERE nodo = ? AND {tcol} >= ? AND {tcol} <= ? AND ({expr}) IS NOT NULL {filtro} "
            f"GROUP BY b ORDER BY b", (paso, paso, nodo, desde, t))
    else:   # agregados horarios (se conservan indefinidamente)
        filas = cx.todos(
            "SELECT (hora / ?) * ? AS b, SUM(prom * n) / SUM(n) AS prom, MIN(vmin) AS mn, MAX(vmax) AS mx, SUM(n) AS n "
            "FROM estacion_agregados_hora WHERE nodo = ? AND var = ? AND hora >= ? AND hora <= ? "
            "GROUP BY b ORDER BY b", (paso, paso, nodo, var, desde - desde % 3600, t))
    pts = [{"t": int(f["b"]), "prom": round(float(f["prom"]), 3), "min": float(f["mn"]), "max": float(f["mx"]),
            "n": int(f["n"])} for f in filas]
    return {"var": var, "rango": rango, "paso_s": paso, "fuente": fuente, "desde": desde, "hasta": t, "puntos": pts}


# ============================================================ trabajo en segundo plano
def _marca(cx, nombre, defecto=0):
    r = cx.uno("SELECT valor FROM estacion_trabajos WHERE nombre = ?", (nombre,))
    return int(r["valor"]) if r else defecto


def _fijar_marca(cx, nombre, valor):
    if cx.ejecutar("UPDATE estacion_trabajos SET valor = ? WHERE nombre = ?", (valor, nombre)) == 0:
        cx.ejecutar("INSERT INTO estacion_trabajos (nombre, valor) VALUES (?, ?)", (nombre, valor))


def procesar_nuevas(cx, t=None, max_filas=5000):
    """Procesa lecturas con id > marca: marca lecturas nuevas de suelo/NPK, evalúa alertas en orden
    cronológico y recalcula los agregados horarios afectados. Devuelve cuántas filas procesó."""
    t = t or ahora()
    marca = _marca(cx, "procesado_id")
    filas = cx.todos("SELECT * FROM estacion_lecturas WHERE id > ? ORDER BY id LIMIT ?", (marca, max_filas))
    if not filas:
        return 0
    cfg = cfgmod.leer(cx)
    horas = {}
    for f in sorted(filas, key=lambda x: (x["nodo"], x["ts"], x["id"])):
        nodo = f["nodo"]
        if f["e_suelo"] == 0 and f["ts_suelo"] is not None:
            f["suelo_nuevo"] = 0 if cx.uno(
                "SELECT 1 AS x FROM estacion_lecturas WHERE nodo = ? AND suelo_nuevo = 1 AND ts_suelo BETWEEN ? AND ?",
                (nodo, f["ts_suelo"] - VENTANA_SUELO_S, f["ts_suelo"] + VENTANA_SUELO_S)) else 1
        if f["ts_npk"] is not None:
            f["npk_nuevo"] = 0 if cx.uno(
                "SELECT 1 AS x FROM estacion_lecturas WHERE nodo = ? AND npk_nuevo = 1 AND ts_npk BETWEEN ? AND ?",
                (nodo, f["ts_npk"] - VENTANA_NPK_S, f["ts_npk"] + VENTANA_NPK_S)) else 1
        if f["suelo_nuevo"] or f["npk_nuevo"]:
            cx.ejecutar("UPDATE estacion_lecturas SET suelo_nuevo = ?, npk_nuevo = ? WHERE id = ?",
                        (f["suelo_nuevo"], f["npk_nuevo"], f["id"]))
        f["npk_fallo"] = 1 if (f["tipo"] == "C" and f["n_npk"] < 3) else 0
        ev = cx.uno("SELECT nodo, ultimo_ts, ultimo_seq FROM estacion_nodo_eval WHERE nodo = ?", (nodo,))
        if not ev or f["ts"] > ev["ultimo_ts"]:
            evaluar_registro(cx, cfg, nodo, f, ev, t)
            if ev:
                cx.ejecutar("UPDATE estacion_nodo_eval SET ultimo_ts = ?, ultimo_seq = ? WHERE nodo = ?",
                            (f["ts"], f["seq"], nodo))
            else:
                cx.ejecutar("INSERT INTO estacion_nodo_eval (nodo, ultimo_ts, ultimo_seq) VALUES (?, ?, ?)",
                            (nodo, f["ts"], f["seq"]))
        hs = horas.setdefault(nodo, set())
        for x in (f["ts"], f["ts_suelo"], f["ts_npk"]):
            if x:
                hs.add(x - x % 3600)
    for nodo, hs in horas.items():
        reagregar(cx, nodo, min(hs), max(hs) + 3600)
    _fijar_marca(cx, "procesado_id", max(f["id"] for f in filas))
    return len(filas)


VARS_AGREGADAS = ["pir", "t_aire", "h_aire", "t1", "t2", "h1", "h2", "t_suelo", "h_suelo", "ph", "ec", "n", "p", "k",
                  "rssi", "snr"]


def reagregar(cx, nodo, desde, hasta):
    """Recalcula estacion_agregados_hora de [desde, hasta) desde el crudo (idempotente)."""
    lim = t_limite_crudo()
    desde = max(desde, lim - lim % 3600 + 3600)   # no pisar horas cuyo crudo ya se purgó (parcial)
    if desde >= hasta:
        return
    cx.ejecutar("DELETE FROM estacion_agregados_hora WHERE nodo = ? AND hora >= ? AND hora < ?", (nodo, desde, hasta))
    for var in VARS_AGREGADAS:
        expr, tcol, filtro = VARS_HIST[var]
        cx.ejecutar(
            f"INSERT INTO estacion_agregados_hora (nodo, hora, var, prom, vmin, vmax, n) "
            f"SELECT nodo, ({tcol} / 3600) * 3600 AS h, '{var}', AVG({expr}), MIN({expr}), MAX({expr}), COUNT(*) "
            f"FROM estacion_lecturas WHERE nodo = ? AND {tcol} >= ? AND {tcol} < ? AND ({expr}) IS NOT NULL {filtro} "
            f"GROUP BY nodo, ({tcol} / 3600) * 3600", (nodo, desde, hasta))


def t_limite_crudo(t=None):
    return (t or ahora()) - ajustes.retencion_dias * 86400


def purgar(cx, t=None, lote=5000):
    """Retención: crudo y latidos > retención se borran por lotes (sin bloquear tablas);
    los agregados horarios se conservan."""
    lim = t_limite_crudo(t)
    marca = _marca(cx, "procesado_id")
    n = cx.ejecutar("DELETE FROM estacion_lecturas WHERE id IN (SELECT id FROM estacion_lecturas WHERE ts < ? AND id <= ? "
                    "ORDER BY id LIMIT ?)", (lim, marca, lote))
    m = cx.ejecutar("DELETE FROM estacion_estado_receptora WHERE id IN (SELECT id FROM estacion_estado_receptora "
                    "WHERE ts < ? ORDER BY id LIMIT ?)", (lim, lote))
    return n, m


TABLAS = ["estacion_lecturas", "estacion_agregados_hora", "estacion_estado_receptora", "estacion_alertas",
          "estacion_comandos", "estacion_config", "estacion_nodo_eval", "estacion_trabajos", "estacion_usuarios"]


def tamano_mb(cx):
    """MB ocupados por las tablas estacion_* (Postgres: pg_total_relation_size; SQLite: tamaño del archivo)."""
    if cx.dialecto() == "postgresql":
        r = cx.uno("SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS b FROM pg_class c "
                   "JOIN pg_namespace n ON n.oid = c.relnamespace "
                   "WHERE c.relkind = 'r' AND c.relname LIKE 'estacion\\_%' AND n.nspname = current_schema()")
        return float(r["b"]) / 1048576
    pc = cx.uno("PRAGMA page_count")
    ps = cx.uno("PRAGMA page_size")
    fl = cx.uno("PRAGMA freelist_count")
    return (list(pc.values())[0] - list(fl.values())[0]) * list(ps.values())[0] / 1048576


def controlar_disco(cx, t=None):
    """Tope duro ESTACION_MAX_MB: si se supera, borra el 10 % más antiguo del crudo (y si ya casi no hay crudo,
    agregados viejos) y abre una alerta 'disco'. Postgres reutiliza el espacio liberado (autovacuum), así que el
    tamaño queda acotado aunque el archivo no se encoja."""
    t = t or ahora()
    mb = tamano_mb(cx)
    nodo = nodo_actual(cx)
    if mb <= ajustes.max_mb:
        if mb < ajustes.max_mb * 0.9:
            alerta_resolver(cx, nodo, "disco", t)
        return mb, 0
    total = cx.uno("SELECT COUNT(*) AS n FROM estacion_lecturas")["n"]
    borrar = max(1000, total // 10)
    n = cx.ejecutar("DELETE FROM estacion_lecturas WHERE id IN (SELECT id FROM estacion_lecturas ORDER BY ts LIMIT ?)",
                    (borrar,)) if total > 720 else 0
    if total <= 720:   # menos de ~1 día de crudo: recortar agregados más viejos
        n = cx.ejecutar("DELETE FROM estacion_agregados_hora WHERE hora IN (SELECT DISTINCT hora FROM "
                        "estacion_agregados_hora ORDER BY hora LIMIT 24 * 30)")
    cx.ejecutar("DELETE FROM estacion_estado_receptora WHERE id IN (SELECT id FROM estacion_estado_receptora "
                "ORDER BY id LIMIT ?)", (borrar,))
    alerta_abrir(cx, nodo, "disco", "disco", f"Tope de disco de la estación superado: {mb:.1f} MB > "
                 f"{ajustes.max_mb:g} MB; se purgaron {n} registros antiguos", mb, t)
    return mb, n


def ciclo_mantenimiento(cx, t=None, max_filas=20000):
    """Un ciclo del trabajo ligero (una transacción): procesar nuevas + sin datos + expirar comandos +
    purga y control de disco (1 vez cada 10 min). En Postgres: advisory lock (no corre en paralelo en
    varios procesos) y statement_timeout del trabajo acotado."""
    t = t or ahora()
    if cx.dialecto() == "postgresql":
        cx.ejecutar(f"SET LOCAL statement_timeout = {int(ajustes.timeout_trabajo_ms)}")
        if not cx.uno("SELECT pg_try_advisory_xact_lock(72291) AS ok")["ok"]:
            return 0
    n = procesar_nuevas(cx, t, max_filas)
    revisar_sin_datos(cx, t)
    if t - _marca(cx, "ultima_purga") >= 600:
        purgar(cx, t)
        controlar_disco(cx, t)
        _fijar_marca(cx, "ultima_purga", t)
    cx.commit()
    return n
