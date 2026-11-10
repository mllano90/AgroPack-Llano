"""Comando "enlace" (prueba de canales LoRa, receptora v4.5.3).

Mismo sobre y la misma clave que el comando wifi (wifi_cmd.py). El texto claro es
"ENL1,<accion>,<n>" para que un sobre WiFi no sirva como orden de canal.
"""
import os

from . import wifi_cmd

ACCIONES = ("prueba", "usar", "fabrica", "cancelar")


class EnlaceInvalido(ValueError):
    pass


def validar(accion, n):
    if accion not in ACCIONES:
        raise EnlaceInvalido("accion invalida")
    if accion == "usar":
        if isinstance(n, bool) or not isinstance(n, int) or not 0 <= n <= 10:
            raise EnlaceInvalido("n debe ser 0..10")
    else:
        if n not in (0, None):
            raise EnlaceInvalido("n debe ser 0")
        n = 0
    return accion, n


def cifrar(token: str, cid: int, accion: str, n: int = 0, nonce: bytes | None = None) -> dict:
    accion, n = validar(accion, n)
    claro = f"ENL1,{accion},{n}".encode()
    nonce = nonce or os.urandom(16)
    if len(nonce) != 16:
        raise EnlaceInvalido("nonce invalido")
    k = wifi_cmd._clave(token)
    datos = bytes(a ^ b for a, b in zip(claro, wifi_cmd._flujo(k, nonce, len(claro))))
    return {"nonce": nonce.hex(), "datos": datos.hex(), "mac": wifi_cmd._mac(k, cid, nonce, datos).hex()}
