"""Router FastAPI autónomo del módulo estación. Montar con prefix="/api/estacion"."""
import asyncio
import csv
import hashlib
import io
import json
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.exc import TimeoutError as SATimeout

from . import auth
from . import config as cfgmod
from . import servicio as sv
from .ajustes import ajustes
from .db import Cx, fabrica

log = logging.getLogger("estacion")
ZONA = timezone(timedelta(hours=-7), "America/Hermosillo")    # UTC-7 fijo, sin horario de verano
router = APIRouter(tags=["estacion"])
def _interno():
    return JSONResponse({"ok": False, "error": "error interno"}, 500)


def _err(st, msg):
    return JSONResponse({"ok": False, "error": msg}, st)


async def _leer_json(request: Request):
    """Lee el cuerpo con tope de tamaño. Devuelve (obj, respuesta_error)."""
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > ajustes.max_cuerpo:
        return None, _err(413, f"cuerpo mayor a {ajustes.max_cuerpo} bytes")
    buf = bytearray()
    async for trozo in request.stream():
        buf += trozo
        if len(buf) > ajustes.max_cuerpo:
            return None, _err(413, f"cuerpo mayor a {ajustes.max_cuerpo} bytes")
    try:
        return json.loads(buf), None
    except (ValueError, UnicodeDecodeError):
        return None, _err(400, "JSON malformado")


# Pool de hilos PROPIO y pequeño: el trabajo de BD de la estación nunca ocupa el threadpool del anfitrión.
_EJECUTOR = ThreadPoolExecutor(max_workers=ajustes.hilos, thread_name_prefix="estacion")


class Ocupado(Exception):
    pass


async def _en_hilo(fn):
    """Ejecuta fn(cx) en el ejecutor propio con una sesión propia; commit; ante excepción: rollback y
    None (500 genérico, sin detalles) o Ocupado (503) si el pool de conexiones está lleno."""
    def trabajo():
        s = fabrica()()
        try:
            r = fn(Cx(s))
            s.commit()
            return r
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()
    try:
        return await asyncio.get_running_loop().run_in_executor(_EJECUTOR, trabajo)
    except SATimeout:
        log.warning("estación: pool de conexiones ocupado")
        return "ocupado"
    except Exception:  # noqa: BLE001
        log.exception("error en el módulo estación")
        return None


def _resp(r):
    if r is None:
        return _interno()
    if r == "ocupado":
        return JSONResponse({"ok": False, "error": "servidor ocupado, reintenta"}, 503, headers={"Retry-After": "10"})
    st, cuerpo = r
    return JSONResponse(cuerpo, st)


# ================================================================ dispositivo (receptora)
_ventana: dict[str, list[float]] = {}


def _limite_ok(request: Request) -> bool:
    """Rate limit por token de dispositivo (ventana deslizante de 60 s)."""
    clave = hashlib.sha256(request.headers.get("authorization", "").encode()).hexdigest()[:16]
    t = time.monotonic()
    v = [x for x in _ventana.get(clave, []) if t - x < 60]
    if len(v) >= ajustes.rate_por_min:
        _ventana[clave] = v
        return False
    v.append(t)
    _ventana[clave] = v
    return True


def _limitado():
    return JSONResponse({"ok": False, "error": "demasiadas peticiones"}, 429, headers={"Retry-After": "30"})


def _sin_token():
    return _err(503, "token de ingesta no configurado") if not ajustes.ingest_token else _err(401, "token inválido")


@router.post("/v1/ingesta")
async def ingesta(request: Request):
    if not auth.token_dispositivo_ok(request):
        return _sin_token()
    if not _limite_ok(request):
        return _limitado()
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    return _resp(await _en_hilo(lambda cx: sv.ingestar(cx, cuerpo)))


@router.post("/v1/estado")
async def estado(request: Request):
    if not auth.token_dispositivo_ok(request):
        return _sin_token()
    if not _limite_ok(request):
        return _limitado()
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    return _resp(await _en_hilo(lambda cx: sv.registrar_estado(cx, cuerpo)))


@router.post("/v1/comandos/{cid}/estado")
async def comando_estado(cid: int, request: Request):
    if not auth.token_dispositivo_ok(request):
        return _sin_token()
    if not _limite_ok(request):
        return _limitado()
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    return _resp(await _en_hilo(lambda cx: sv.reportar_comando(cx, cid, cuerpo)))


@router.get("/salud")
async def salud():
    r = await _en_hilo(lambda cx: (200, {"ok": True, "db": cx.dialecto(), "x": cx.uno("SELECT 1 AS x")["x"]}))
    return _resp(r)


# ================================================================ login de la interfaz
_fallos: dict[str, list[float]] = {}


@router.post("/auth/login")
async def login(request: Request):
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    if not isinstance(cuerpo, dict):
        return _err(400, "usuario y clave requeridos")
    ip = request.client.host if request.client else "?"
    t = time.time()
    recientes = [x for x in _fallos.get(ip, []) if t - x < 600]
    if len(recientes) >= 10:
        return _err(429, "demasiados intentos, espera 10 minutos")
    u, c = str(cuerpo.get("usuario", ""))[:64], str(cuerpo.get("clave", ""))[:200]

    def fn(cx):
        return auth.autenticar(cx, u, c)
    ok = await _en_hilo(fn)
    if ok is None or ok == "ocupado":
        return _interno()
    if not ok:
        recientes.append(t)
        _fallos[ip] = recientes
        return _err(401, "usuario o contraseña incorrectos")
    _fallos.pop(ip, None)
    token, exp = auth.crear_jwt(ok["usuario"], ok["rol"])
    return {"ok": True, "token": token, "usuario": ok["usuario"], "rol": ok["rol"], "expira": exp}


@router.get("/auth/yo")
def yo(sesion: dict = Depends(auth.sesion_estacion)):
    return {"usuario": sesion["usuario"], "rol": sesion["rol"]}


@router.get("/usuarios")
async def listar_usuarios(_admin: str = Depends(auth.admin_actual)):
    def fn(cx):
        filas = cx.todos("SELECT usuario, rol, activo, creado FROM estacion_usuarios ORDER BY usuario")
        return 200, {"usuarios": [{"usuario": f["usuario"], "rol": "admin" if f["rol"] == "admin" else "normal",
                                   "activo": bool(f["activo"]), "creado": f["creado"]} for f in filas]}
    return _resp(await _en_hilo(fn))


@router.post("/usuarios")
async def crear_usuario(request: Request, _admin: str = Depends(auth.admin_actual)):
    """Crea una cuenta normal. El cuerpo no puede elegir rol: siempre es normal."""
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    if not isinstance(cuerpo, dict):
        return _err(400, "usuario y clave requeridos")
    try:
        usuario, clave = auth.validar_cuenta_nueva(cuerpo.get("usuario"), cuerpo.get("clave"))
    except ValueError as ex:
        return _err(400, str(ex))

    def fn(cx):
        if cx.uno("SELECT id FROM estacion_usuarios WHERE usuario = ?", (usuario,)):
            return 409, {"ok": False, "error": "ese usuario ya existe"}
        n = cx.uno("SELECT COUNT(*) AS n FROM estacion_usuarios")["n"]
        if n >= 40:
            return 400, {"ok": False, "error": "hay demasiadas cuentas"}
        cx.ejecutar(
            "INSERT INTO estacion_usuarios (usuario, hash, activo, rol, creado) VALUES (?, ?, ?, ?, ?)",
            (usuario, auth.hash_clave(clave), True, "normal", int(time.time())))
        return 200, {"ok": True, "usuario": usuario, "rol": "normal"}
    return _resp(await _en_hilo(fn))


# ================================================================ API de la interfaz (JWT)
def _nodo(cx, request):
    return request.query_params.get("nodo") or sv.nodo_actual(cx)


@router.get("/ultimo")
async def ultimo(request: Request, usuario: str = Depends(auth.usuario_actual)):
    def fn(cx):
        d = sv.ultimo(cx, _nodo(cx, request))
        d["usuario"] = usuario
        return 200, d
    return _resp(await _en_hilo(fn))


def _caja_solo_admin(var: str, sesion: dict):
    if var in sv.VARS_CAJA and sesion["rol"] != "admin":
        return _err(403, "solo el administrador de la estación")
    return None


@router.get("/resumen-dia")
async def resumen_dia(request: Request, _u: str = Depends(auth.usuario_actual)):
    return _resp(await _en_hilo(lambda cx: (200, sv.resumen_dia(cx, _nodo(cx, request)))))


@router.get("/historial")
async def historial(request: Request, var: str = "t_aire", rango: str = "24h",
                    desde: int | None = None, hasta: int | None = None,
                    sesion: dict = Depends(auth.sesion_estacion)):
    if var not in sv.VARS_HIST:
        return _err(400, "variable o rango inválido")
    veto = _caja_solo_admin(var, sesion)
    if veto:
        return veto
    if desde is not None or hasta is not None:
        if desde is None or hasta is None or hasta <= desde:
            return _err(400, "ventana inválida")
        return _resp(await _en_hilo(lambda cx: (200, sv.historial_ventana(cx, _nodo(cx, request), var, desde, hasta))))
    if rango not in sv.RANGOS:
        return _err(400, "variable o rango inválido")
    return _resp(await _en_hilo(lambda cx: (200, sv.historial(cx, _nodo(cx, request), var, rango))))


MAX_FILAS_CSV = 50000
CSV_COLS = ["ts", "seq", "tipo", "t1", "h1", "e_a1", "t2", "h2", "e_a2", "pir", "e_pir", "t_suelo", "h_suelo",
            "e_suelo", "ts_suelo", "ec", "ph", "n", "p", "k", "n_npk", "edad_npk", "ts_npk", "rssi", "snr", "csv",
            "e_int", "t_int", "h_int"]


def _hora(ts):
    return datetime.fromtimestamp(ts, ZONA).strftime("%Y-%m-%d %H:%M:%S") if ts else ""


@router.get("/historial.csv")
async def historial_csv(request: Request, rango: str = "24h", _u: str = Depends(auth.usuario_actual)):
    if rango not in sv.RANGOS:
        return _err(400, "rango inválido")
    dur, _, fuente = sv.RANGOS[rango]

    def fn(cx):
        nodo = _nodo(cx, request)
        buf = io.StringIO()
        w = csv.writer(buf)
        desde = sv.ahora() - dur
        if dur <= ajustes.retencion_dias * 86400:      # crudo
            w.writerow(["hora_hermosillo"] + CSV_COLS)
            for f in cx.todos(f"SELECT {', '.join(CSV_COLS)} FROM estacion_lecturas WHERE nodo = ? AND ts >= ? ORDER BY ts LIMIT ?",
                              (nodo, desde, MAX_FILAS_CSV)):
                w.writerow([_hora(f["ts"])] + ["" if f[c] is None else f[c] for c in CSV_COLS])
        else:                                       # agregados horarios
            w.writerow(["hora_hermosillo", "hora_ts", "variable", "promedio", "minimo", "maximo", "n"])
            for f in cx.todos("SELECT hora, var, prom, vmin, vmax, n FROM estacion_agregados_hora "
                              "WHERE nodo = ? AND hora >= ? ORDER BY hora, var LIMIT ?", (nodo, desde, MAX_FILAS_CSV)):
                w.writerow([_hora(f["hora"]), f["hora"], f["var"], round(f["prom"], 3), f["vmin"], f["vmax"], f["n"]])
        return nodo, buf.getvalue()
    r = await _en_hilo(fn)
    if r is None or r == "ocupado":
        return _interno()
    nodo, txt = r
    nombre = f"estacion_{nodo}_{rango}_{datetime.now(ZONA):%Y%m%d_%H%M}.csv"
    return StreamingResponse(iter(["\ufeff" + txt]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


@router.get("/config")
async def leer_config(_u: str = Depends(auth.admin_actual)):
    def fn(cx):
        c = cfgmod.leer(cx)
        c["variables"] = {k: {"nombre": v[0], "unidad": v[1]} for k, v in cfgmod.VARIABLES.items()}
        return 200, c
    return _resp(await _en_hilo(fn))


@router.put("/config")
async def guardar_config(request: Request, _u: str = Depends(auth.admin_actual)):
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    try:
        nuevo = cfgmod.validar(cuerpo if isinstance(cuerpo, dict) else {})
    except (ValueError, TypeError) as ex:
        return _err(400, str(ex))

    def fn(cx):
        cfgmod.guardar(cx, nuevo)
        return 200, {"ok": True, "config": nuevo}
    return _resp(await _en_hilo(fn))


@router.get("/alertas")
async def alertas(request: Request, estado: str = "todas", limite: int = 200, _u: str = Depends(auth.usuario_actual)):
    def fn(cx):
        nodo = _nodo(cx, request)
        q, p = "SELECT * FROM estacion_alertas WHERE nodo = ?", [nodo]
        if estado in ("activa", "resuelta"):
            q += " AND estado = ?"
            p.append(estado)
        q += " ORDER BY CASE WHEN estado = 'activa' THEN 0 ELSE 1 END, ultima DESC LIMIT ?"
        p.append(max(1, min(limite, 1000)))
        return 200, {"nodo": nodo, "alertas": cx.todos(q, tuple(p))}
    return _resp(await _en_hilo(fn))


@router.post("/alertas/{aid}/resolver")
async def resolver_alerta(aid: int, _u: str = Depends(auth.admin_actual)):
    def fn(cx):
        n = cx.ejecutar("UPDATE estacion_alertas SET estado = 'resuelta', fin = ? WHERE id = ? AND estado = 'activa' "
                        "AND tipo <> 'comando'", (sv.ahora(), aid))
        return 200, {"ok": n == 1}
    return _resp(await _en_hilo(fn))


@router.get("/comandos")
async def comandos(request: Request, _u: str = Depends(auth.admin_actual)):
    def fn(cx):
        sv.expirar_comandos(cx, sv.ahora())
        return 200, {"comandos": sv.listar_comandos(cx, _nodo(cx, request))}
    return _resp(await _en_hilo(fn))


@router.post("/comandos")
async def crear_comando(request: Request, usuario: str = Depends(auth.admin_actual)):
    cuerpo, e = await _leer_json(request)
    if e:
        return e
    cuerpo = cuerpo if isinstance(cuerpo, dict) else {}

    def fn(cx):
        try:
            c = sv.crear_comando(cx, cuerpo.get("nodo") or _nodo(cx, request), cuerpo.get("tipo", "ota"),
                                 {"duracion_min": cuerpo.get("duracion_min", 15)}, usuario)
        except LookupError as ex:
            return 409, {"ok": False, "error": str(ex)}
        except ValueError as ex:
            return 400, {"ok": False, "error": str(ex)}
        return 200, {"ok": True, "comando": c}
    return _resp(await _en_hilo(fn))


@router.post("/comandos/{cid}/cancelar")
async def cancelar_comando(cid: int, _u: str = Depends(auth.admin_actual)):
    return _resp(await _en_hilo(lambda cx: sv.cancelar_comando(cx, cid)))
