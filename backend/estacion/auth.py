"""Autenticación propia del módulo: usuarios en estacion_usuarios (PBKDF2) y JWT HS256 (stdlib)."""
import base64
import hashlib
import hmac
import json
import re
import secrets
import time

from fastapi import Depends, HTTPException, Request

from .ajustes import ajustes

ITER = 200_000
RE_USUARIO = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
CLAVES_DEBILES = {
    "admin123", "clave123", "password", "password1", "123456789", "1234567890",
    "qwertyuiop", "estacion1", "estacion123",
}


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


def crear_jwt(usuario: str, rol: str = "normal", t=None) -> tuple[str, int]:
    t = int(t or time.time())
    exp = t + ajustes.jwt_horas * 3600
    cab = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    cuerpo = _b64(json.dumps({
        "sub": usuario, "rol": rol if rol == "admin" else "normal",
        "iat": t, "exp": exp, "aud": "estacion", "iss": "estacion",
    }, separators=(",", ":")).encode())
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


def _rol_de(valor) -> str:
    return "admin" if valor == "admin" else "normal"


def sesion_estacion(request: Request) -> dict:
    """Usuario vivo en estacion_usuarios. El rol se lee de la tabla, no del JWT."""
    h = request.headers.get("authorization", "")
    d = leer_jwt(h[7:].strip()) if h.startswith("Bearer ") else None
    if not d or not d.get("sub"):
        raise HTTPException(401, "sesión requerida")
    from .db import Cx, fabrica
    s = fabrica()()
    try:
        r = Cx(s).uno("SELECT usuario, rol, activo FROM estacion_usuarios WHERE usuario = ?", (d["sub"],))
    finally:
        s.close()
    if not r or not r["activo"]:
        raise HTTPException(401, "sesión requerida")
    return {"usuario": r["usuario"], "rol": _rol_de(r["rol"])}


def usuario_actual(sesion: dict = Depends(sesion_estacion)) -> str:
    return sesion["usuario"]


def admin_actual(sesion: dict = Depends(sesion_estacion)) -> str:
    if sesion["rol"] != "admin":
        raise HTTPException(403, "solo el administrador de la estación")
    return sesion["usuario"]


def token_dispositivo_ok(request: Request) -> bool:
    h = request.headers.get("authorization", "")
    return bool(ajustes.ingest_token) and h.startswith("Bearer ") and \
        hmac.compare_digest(h[7:].strip().encode(), ajustes.ingest_token.encode())


def sembrar_admin(cx):
    """Si hay ESTACION_ADMIN_USER/PASS en el entorno, crea o actualiza ese administrador."""
    if not ajustes.admin_pass:
        return
    r = cx.uno("SELECT id, hash, rol FROM estacion_usuarios WHERE usuario = ?", (ajustes.admin_user,))
    if r and r.get("rol") == "admin" and verificar_clave(ajustes.admin_pass, r["hash"]):
        return
    h = r["hash"] if r and verificar_clave(ajustes.admin_pass, r["hash"]) else hash_clave(ajustes.admin_pass)
    if r:
        cx.ejecutar("UPDATE estacion_usuarios SET hash = ?, activo = ?, rol = ? WHERE id = ?",
                    (h, True, "admin", r["id"]))
    else:
        cx.ejecutar(
            "INSERT INTO estacion_usuarios (usuario, hash, activo, rol, creado) VALUES (?, ?, ?, ?, ?)",
            (ajustes.admin_user, h, True, "admin", int(time.time())))
    cx.commit()


def validar_cuenta_nueva(usuario, clave) -> tuple[str, str]:
    """Reglas de una cuenta normal. No registra ni devuelve la clave en el mensaje."""
    usuario = str(usuario or "").strip()
    clave = str(clave or "")
    if not RE_USUARIO.match(usuario):
        raise ValueError("el usuario debe tener de 3 a 32 caracteres: letras, números, _ o -")
    if not 10 <= len(clave) <= 72:
        raise ValueError("la contraseña debe tener entre 10 y 72 caracteres")
    if clave.lower() == usuario.lower() or clave.lower() in CLAVES_DEBILES:
        raise ValueError("esa contraseña es demasiado débil")
    if not re.search(r"[A-Za-z]", clave) or not re.search(r"\d", clave):
        raise ValueError("la contraseña necesita letras y números")
    return usuario, clave


def autenticar(cx, usuario: str, clave: str):
    """Dict {usuario, rol} si la clave cuadra y está activo. False si no. Nunca incluye la clave en claro."""
    r = cx.uno("SELECT usuario, hash, activo, rol FROM estacion_usuarios WHERE usuario = ?", (usuario,))
    if not r or not r["activo"]:
        verificar_clave(clave, hash_clave("x"))   # tiempo similar exista o no el usuario
        return False
    if not verificar_clave(clave, r["hash"]):
        return False
    return {"usuario": r["usuario"], "rol": _rol_de(r["rol"])}
