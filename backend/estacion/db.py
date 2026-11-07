"""Acceso a datos del módulo.

* `obtener_sesion` es la dependencia FastAPI que usa el router. En AgroPack se sustituye con
  `app.dependency_overrides[estacion.db.obtener_sesion] = get_db` (su propia Session de SQLAlchemy).
* `Cx` es un adaptador mínimo para escribir el SQL de servicio.py con marcadores '?' sobre una Session.
  Todo el SQL es portable SQLite/Postgres (ON CONFLICT DO NOTHING, división entera de BIGINT, etc.).
"""
import os
import re
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

_SessionLocal = None
_motor = None
_RE_Q = re.compile(r"\?")


def url_desde_entorno() -> str:
    from .ajustes import ajustes
    ajustes.recargar() if not ajustes.database_url else None
    url = (ajustes.database_url or os.environ.get("DATABASE_URL", "")).strip()
    # AgroPack ya trae psycopg2. No agregamos un segundo driver (psycopg 3).
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    if not url:
        ruta = os.environ.get("SQLITE_PATH") or str(Path(__file__).resolve().parent.parent / "datos" / "estacion.db")
        Path(ruta).parent.mkdir(parents=True, exist_ok=True)
        url = "sqlite:///" + ruta
    return url


def crear_motor(url: str | None = None):
    url = url or url_desde_entorno()
    if url.startswith("sqlite"):
        motor = create_engine(url, connect_args={"check_same_thread": False, "timeout": 15})

        @event.listens_for(motor, "connect")
        def _pragmas(dbapi, _):
            c = dbapi.cursor()
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
            c.close()
    else:
        from .ajustes import ajustes
        # Engine PROPIO y pequeño: pool_size 2, sin overflow, espera máx. 3 s por conexión.
        # statement_timeout / lock_timeout cortos en TODAS las conexiones de la estación (no afecta al anfitrión).
        motor = create_engine(
            url, pool_size=ajustes.pool_size, max_overflow=0, pool_timeout=3, pool_pre_ping=True, pool_recycle=1800,
            connect_args={"options": f"-c statement_timeout={ajustes.statement_timeout_ms} -c lock_timeout=500 "
                                     f"-c idle_in_transaction_session_timeout=10000",
                          "application_name": "estacion", "connect_timeout": 5})
    return motor


def configurar(session_factory=None, motor=None):
    """Define la fábrica de sesiones del módulo (standalone o la SessionLocal de AgroPack)."""
    global _SessionLocal, _motor
    if session_factory is None:
        _motor = motor or crear_motor()
        session_factory = sessionmaker(bind=_motor, autoflush=False, expire_on_commit=False)
    _SessionLocal = session_factory
    return session_factory


def fabrica():
    if _SessionLocal is None:
        configurar()
    return _SessionLocal


def obtener_sesion():
    s = fabrica()()
    try:
        yield s
    finally:
        s.close()


class Cx:
    """Adaptador: cx.ejecutar / cx.todos / cx.uno con marcadores '?'."""

    def __init__(self, sesion: Session):
        self.s = sesion

    @staticmethod
    def _sql(sql, params):
        i = iter(range(len(params)))
        return text(_RE_Q.sub(lambda _: f":p{next(i)}", sql)), {f"p{j}": v for j, v in enumerate(params)}

    def ejecutar(self, sql, params=()):
        q, p = self._sql(sql, params)
        return self.s.execute(q, p).rowcount

    def todos(self, sql, params=()):
        q, p = self._sql(sql, params)
        return [dict(r._mapping) for r in self.s.execute(q, p)]

    def uno(self, sql, params=()):
        r = self.todos(sql, params)
        return r[0] if r else None

    def dialecto(self):
        return self.s.get_bind().dialect.name

    def commit(self):
        self.s.commit()
