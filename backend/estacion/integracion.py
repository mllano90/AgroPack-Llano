"""Registro del módulo en una app FastAPI anfitriona (AgroPack o standalone) SIN poder tumbarla.

    from estacion.integracion import registrar_estacion
    registrar_estacion(app)            # monta /api/estacion/*; nunca lanza excepción

* ESTACION_HABILITADA=0  ⇒ no monta nada (apagado sin deploy de código).
* Usa su PROPIO engine (pool 2, sin overflow, statement_timeout 2 s) y su propio pool de 2 hilos.
* El trabajo de fondo corre en un hilo daemon propio (no depende del lifespan del anfitrión) con
  advisory lock en Postgres (si hay varios workers, solo uno trabaja a la vez).
"""
import logging
import threading
import time

log = logging.getLogger("estacion")
_hilo = None
_parar = threading.Event()


def registrar_estacion(app, prefix: str = "/api/estacion", iniciar_trabajo: bool = True) -> bool:
    try:
        from .ajustes import ajustes
        ajustes.recargar()
        if not ajustes.habilitada:
            log.warning("Módulo estación DESHABILITADO (ESTACION_HABILITADA=0)")
            return False
        from . import db
        from .auth import sembrar_admin
        from .db import Cx
        from .modelos import crear_tablas
        from .router import router
        fabrica = db.configurar()
        crear_tablas(db._motor)                      # solo tablas estacion_* (metadata propia)
        s = fabrica()
        try:
            sembrar_admin(Cx(s))
        finally:
            s.close()
        app.include_router(router, prefix=prefix)
        if iniciar_trabajo:
            iniciar_hilo_trabajo(ajustes.intervalo_trabajo_s)
        log.info("Módulo estación montado en %s", prefix)
        return True
    except Exception:  # noqa: BLE001 — la app anfitriona debe seguir funcionando
        log.exception("Módulo estación NO se pudo registrar; la app continúa sin él")
        return False


def iniciar_hilo_trabajo(intervalo: int):
    global _hilo
    if _hilo and _hilo.is_alive():
        return
    _parar.clear()

    def bucle():
        from .tareas import ejecutar_ciclo
        while not _parar.wait(intervalo):
            t0 = time.monotonic()
            n = ejecutar_ciclo()
            if n:
                log.debug("estación: %s lecturas procesadas en %.2f s", n, time.monotonic() - t0)

    _hilo = threading.Thread(target=bucle, name="estacion-trabajo", daemon=True)
    _hilo.start()


def detener_hilo_trabajo():
    _parar.set()
