"""Autenticación propia del módulo: usuarios en estacion_usuarios (PBKDF2) y JWT HS256 (stdlib)."""
import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Depends, HTTPException, Request

from .ajustes import ajustes

ITER = 200_000


def hash_clave(clave: str) -> str:
    sal = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", clave.encode(), sal.encode(), ITER).hex()
    return f"pbkdf2_sha256${ITER}${sal}${h}"


def verificar_clave(clave: str, guardado: str) -> bool:
    try:
        _, it, sal, h = guardado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", clave.encode(), sal.encode(), int(it)).hex()
        return hmac.compare_digest(calc, h)
    except (ValueError, TypeError):
        return False


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def crear_jwt(usuario: str, t=None) -> tuple[str, int]:
    t = int(t or time.time())
    exp = t + ajustes.jwt_horas * 3600
    cab = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    cuerpo = _b64(json.dumps({"sub": usuario, "iat": t, "exp": exp, "aud": "estacion", "iss": "estacion"}, separators=(",", ":")).encode())
    firma = _b64(hmac.new(ajustes.secreto.encode(), f"{cab}.{cuerpo}".encode(), hashlib.sha256).digest())
    return f"{cab}.{cuerpo}.{firma}", exp


def leer_jwt(token: str):
    try:
        cab, cuerpo, firma = token.split(".")
        esperado = _b64(hmac.new(ajustes.secreto.encode(), f"{cab}.{cuerpo}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(esperado, firma):
            return None
        if json.loads(_unb64(cab)).get("alg") != "HS256":
            return None
        d = json.loads(_unb64(cuerpo))
        if d.get("aud") != "estacion" or d.get("iss") != "estacion" or d.get("exp", 0) < time.time():
            return None
        return d
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


async def usuario_actual(request: Request) -> str:
    h = request.headers.get("authorization", "")
    d = leer_jwt(h[7:].strip()) if h.startswith("Bearer ") else None
    if not d:
        raise HTTPException(401, "sesión requerida")
    return d["sub"]


def token_dispositivo_ok(request: Request) -> bool:
    h = request.headers.get("authorization", "")
    return bool(ajustes.ingest_token) and h.startswith("Bearer ") and \
        hmac.compare_digest(h[7:].strip().encode(), ajustes.ingest_token.encode())


def sembrar_admin(cx):
    """Si hay ESTACION_ADMIN_USER/PASS en el entorno, crea o actualiza ese usuario."""
    if not ajustes.admin_pass:
        return
    r = cx.uno("SELECT id, hash FROM estacion_usuarios WHERE usuario = ?", (ajustes.admin_user,))
    if r and verificar_clave(ajustes.admin_pass, r["hash"]):
        return
    h = hash_clave(ajustes.admin_pass)
    if r:
        cx.ejecutar("UPDATE estacion_usuarios SET hash = ?, activo = ? WHERE id = ?", (h, True, r["id"]))
    else:
        cx.ejecutar("INSERT INTO estacion_usuarios (usuario, hash, activo, creado) VALUES (?, ?, ?, ?)",
                    (ajustes.admin_user, h, True, int(time.time())))
    cx.commit()


def autenticar(cx, usuario: str, clave: str) -> bool:
    r = cx.uno("SELECT hash, activo FROM estacion_usuarios WHERE usuario = ?", (usuario,))
    if not r or not r["activo"]:
        verificar_clave(clave, hash_clave("x"))   # tiempo similar exista o no el usuario
        return False
    return verificar_clave(clave, r["hash"])
