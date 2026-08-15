import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import Base, engine, ensure_schema, SessionLocal

settings = get_settings()

# Routers
from app.routers.auth import router as auth_router
from app.routers.recepcion import router as recepcion_router
from app.routers.empaque import router as empaque_router
from app.routers.parrilla import router as parrilla_router
from app.routers.reports import router as reports_router
from app.routers.embarques import router as embarques_router
from app.routers.clientes import router as clientes_router   # ← NUEVO
from app.routers.correcciones import router as correcciones_router

# Crear tablas y columnas nuevas
try:
    Base.metadata.create_all(bind=engine)
    ensure_schema()
except Exception as e:
    # No tumbar el proceso: el health reportará el error de BD
    print(f"⚠️ Error al iniciar schema: {e}")
    traceback.print_exc()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Sistema de control de inventarios para empaque y embarques de uva",
    version=settings.VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Evita 500 opaco; expone el error real (login/BD) para diagnosticar en prod."""
    from fastapi import HTTPException
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    # Handlers específicos de FastAPI/Starlette tienen prioridad; esto es red de seguridad.
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    if isinstance(exc, StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    if isinstance(exc, RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": exc.errors()})
    tb = traceback.format_exc()
    print(f"UNHANDLED {request.method} {request.url.path}: {exc}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={
            "detail": f"Error interno: {type(exc).__name__}: {exc}",
            "path": str(request.url.path),
        },
    )


# Incluir routers
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(recepcion_router, prefix="/api/recepcion", tags=["Recepción"])
app.include_router(empaque_router, prefix="/api/empaque", tags=["Empaque"])
app.include_router(parrilla_router, prefix="/api/parrilla", tags=["Parrillas"])
app.include_router(reports_router, prefix="/api/reports", tags=["Reportes"])
app.include_router(embarques_router, prefix="/api/embarques", tags=["Embarques"])
app.include_router(clientes_router, prefix="/api/clientes", tags=["Clientes"])  # ← NUEVO
app.include_router(correcciones_router, prefix="/api/correcciones", tags=["Correcciones"])

@app.get("/")
async def root():
    return {
        "message": "✅ AgroPack Llano funcionando correctamente",
        "status": "online"
    }


@app.get("/api/health/db")
async def health_db():
    """Diagnóstico de conexión a BD (sin auth)."""
    db_url = settings.DATABASE_URL or ""
    # Ocultar password en la URL mostrada
    safe = db_url
    if "@" in db_url:
        try:
            pre, post = db_url.split("@", 1)
            scheme = pre.split("://", 1)[0] if "://" in pre else "db"
            safe = f"{scheme}://***@{post}"
        except Exception:
            safe = "***"
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            # Conteo básico de tablas críticas
            users = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
            return {
                "status": "ok",
                "database": safe,
                "users": int(users or 0),
            }
        finally:
            db.close()
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": safe,
                "detail": f"{type(e).__name__}: {e}",
            },
        )
