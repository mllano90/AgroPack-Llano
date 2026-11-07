"""Trabajo ligero en segundo plano (fuera de las peticiones).

* En el proceso web: `iniciar_tarea_fondo()` en el lifespan (asyncio, cada ESTACION_INTERVALO_TRABAJO_S s).
* O como proceso aparte / Render Cron:  python -m estacion.tareas --una-vez
"""
import argparse
import asyncio
import logging
import time

from . import db, servicio
from .db import Cx

log = logging.getLogger("estacion.tareas")


def ejecutar_ciclo():
    s = db.fabrica()()
    try:
        return servicio.ciclo_mantenimiento(Cx(s))
    except Exception:  # noqa: BLE001
        s.rollback()
        log.exception("ciclo de mantenimiento de la estación falló")
        return -1
    finally:
        s.close()


async def _bucle(intervalo):
    while True:
        await asyncio.sleep(intervalo)
        await asyncio.to_thread(ejecutar_ciclo)


def iniciar_tarea_fondo(intervalo=None):
    from .ajustes import ajustes
    return asyncio.create_task(_bucle(intervalo or ajustes.intervalo_trabajo_s))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--una-vez", action="store_true")
    a = ap.parse_args()
    from .modelos import crear_tablas
    db.configurar()
    crear_tablas(db._motor)
    while True:
        print("procesadas:", ejecutar_ciclo(), flush=True)
        if a.una_vez:
            break
        time.sleep(30)
