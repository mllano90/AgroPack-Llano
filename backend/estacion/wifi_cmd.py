"""Comando "wifi" de la receptora v4.4 (cambio de red desde la web).

Decisión de seguridad (documentada en el README, §15):
* La contraseña WiFi NUNCA se guarda en claro en la BD (SQLite/Postgres). El comando guarda solo un
  sobre CIFRADO con una clave derivada del token de ingesta (ESTACION_INGEST_TOKEN, variable de
  entorno: no vive en la BD). Quien copie la BD sin el entorno no puede leer la clave.
* El sobre es de UN SOLO USO: se borra del servidor en cuanto la receptora confirma que lo recibió
  ("activo" = probando) o el comando termina (completado/fallido/expirado/cancelado). Mientras está
  "entregado_receptora" se conserva solo para re-entregarlo si la respuesta se perdió (máx. 30 min).
* La receptora recibe el mismo sobre (también cifrado en HTTP sin TLS de la LAN) y lo descifra con su
  TOKEN_SERVIDOR. El MAC liga el sobre al id del comando (no se puede reutilizar con otro id).
* La API de la interfaz nunca devuelve la contraseña: solo "configurada"/"vacía".

Algoritmo (idéntico a receptora/wifi_logica.h):
    K     = HMAC-SHA256(token, "EM-SIF/wifi/v1")
    claro = flags(1 B) || ssid || 0x00 || clave || 0x00 || url       flags bit0 = conservar la clave guardada
    flujo = HMAC-SHA256(K, "E" || nonce(16) || i)  i = 0, 1, ...
    datos = claro XOR flujo
    mac   = HMAC-SHA256(K, "M" || str(id) || nonce || datos)[:16]
"""
import hashlib
import hmac
import os
import re

ETIQUETA = b"EM-SIF/wifi/v1"
RE_URL = re.compile(r'^https?://[^\s"\\]{1,112}$')


class WifiInvalido(ValueError):
    pass


def _clave(token: str) -> bytes:
    return hmac.new(token.encode(), ETIQUETA, hashlib.sha256).digest()


def _flujo(k: bytes, nonce: bytes, n: int) -> bytes:
    out = b""
    i = 0
    while len(out) < n:
        out += hmac.new(k, b"E" + nonce + bytes([i]), hashlib.sha256).digest()
        i += 1
    return out[:n]


def _mac(k: bytes, cid: int, nonce: bytes, datos: bytes) -> bytes:
    return hmac.new(k, b"M" + str(cid).encode() + nonce + datos, hashlib.sha256).digest()[:16]


def validar(ssid, clave, url, conservar=False, red_abierta=False):
    """Devuelve (ssid, clave, url) normalizados o lanza WifiInvalido con un texto para la interfaz."""
    if not isinstance(ssid, str) or not ssid.strip():
        raise WifiInvalido("Escribe el nombre de la red (SSID)")
    ssid = ssid.strip()
    if len(ssid.encode()) > 32:
        raise WifiInvalido("El SSID no puede pasar de 32 bytes")
    if "\x00" in ssid:
        raise WifiInvalido("SSID inválido")
    clave = clave if isinstance(clave, str) else ""
    if clave:
        if not all(32 <= ord(c) <= 126 for c in clave):
            raise WifiInvalido("La contraseña solo admite caracteres ASCII imprimibles")
        if len(clave) == 64:
            if not re.fullmatch(r"[0-9a-fA-F]{64}", clave):
                raise WifiInvalido("Una contraseña de 64 caracteres debe ser hexadecimal")
        elif not 8 <= len(clave) <= 63:
            raise WifiInvalido("La contraseña WPA2 debe tener de 8 a 63 caracteres")
    elif not conservar and not red_abierta:
        raise WifiInvalido("Escribe la contraseña, o marca \"Red abierta\" / \"Conservar la contraseña guardada\"")
    url = (url or "").strip() if isinstance(url, str) or url is None else None
    if url is None:
        raise WifiInvalido("URL inválida")
    url = url.rstrip("/")
    if url and not RE_URL.match(url):
        raise WifiInvalido("La URL del servidor debe empezar con http:// o https:// (máx. 120 caracteres, sin espacios)")
    return ssid, ("" if conservar else clave), url


def cifrar(token: str, cid: int, ssid: str, clave: str, url: str, conservar: bool = False, nonce: bytes | None = None) -> dict:
    nonce = nonce or os.urandom(16)
    claro = bytes([1 if conservar else 0]) + ssid.encode() + b"\x00" + clave.encode() + b"\x00" + url.encode()
    k = _clave(token)
    datos = bytes(a ^ b for a, b in zip(claro, _flujo(k, nonce, len(claro))))
    return {"nonce": nonce.hex(), "datos": datos.hex(), "mac": _mac(k, cid, nonce, datos).hex()}


def descifrar(token: str, cid: int, sobre: dict) -> dict:
    """Solo para pruebas (el servidor nunca necesita descifrar)."""
    k = _clave(token)
    nonce, datos, mac = bytes.fromhex(sobre["nonce"]), bytes.fromhex(sobre["datos"]), bytes.fromhex(sobre["mac"])
    if not hmac.compare_digest(_mac(k, cid, nonce, datos), mac):
        raise WifiInvalido("firma inválida")
    claro = bytes(a ^ b for a, b in zip(datos, _flujo(k, nonce, len(datos))))
    ssid, clave, url = claro[1:].split(b"\x00", 2)
    return {"conservar": bool(claro[0] & 1), "ssid": ssid.decode(), "clave": clave.decode(), "url": url.decode()}
