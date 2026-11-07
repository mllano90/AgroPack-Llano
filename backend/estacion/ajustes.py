"""Variables de entorno del módulo (todas con prefijo ESTACION_; algunas aceptan respaldo sin prefijo en standalone)."""
import logging
import os
import secrets

log = logging.getLogger("estacion")
_aviso_secreto = False


def _env(nombre, defecto="", respaldo=True):
    v = os.environ.get("ESTACION_" + nombre)
    if v is None and respaldo:
        v = os.environ.get(nombre)
    return defecto if v is None or v == "" else v


class Ajustes:
    def __init__(self):
        self.recargar()

    def recargar(self):
        self.habilitada = _env("HABILITADA", "1", False) not in ("0", "false", "no")
        self.database_url = _env("DATABASE_URL", "")              # ESTACION_DATABASE_URL o DATABASE_URL
        self.ingest_token = _env("INGEST_TOKEN")
        self.admin_user = _env("ADMIN_USER", "admin")
        self.admin_pass = _env("ADMIN_PASS")
        # Secreto JWT PROPIO (nunca el de AgroPack). Sin él: aleatorio por arranque (las sesiones caducan al reiniciar).
        self.secreto = _env("SECRET", "", False)
        if not self.secreto:
            self.secreto = secrets.token_hex(32)
            # Apagado no hace falta avisar: no hay sesiones. Encendido, un solo aviso.
            global _aviso_secreto
            if self.habilitada and not _aviso_secreto:
                _aviso_secreto = True
                log.warning("ESTACION_SECRET no definido: se usa uno aleatorio (las sesiones se pierden al reiniciar)")
        self.jwt_horas = int(_env("JWT_HORAS", "336", False))
        self.max_cuerpo = int(_env("MAX_CUERPO_BYTES", str(256 * 1024), False))
        self.max_lote = int(_env("MAX_LOTE", "200", False))
        self.rate_por_min = int(_env("RATE_POR_MIN", "30", False))
        self.intervalo_trabajo_s = int(_env("INTERVALO_TRABAJO_S", "30", False))
        self.statement_timeout_ms = int(_env("STATEMENT_TIMEOUT_MS", "2000", False))
        self.timeout_trabajo_ms = int(_env("TIMEOUT_TRABAJO_MS", "15000", False))
        self.pool_size = int(_env("POOL_SIZE", "2", False))
        self.hilos = int(_env("HILOS", "2", False))
        self.max_mb = float(_env("MAX_MB", "150", False))
        self.retencion_dias = int(_env("RETENCION_DIAS", "30", False))


ajustes = Ajustes()
