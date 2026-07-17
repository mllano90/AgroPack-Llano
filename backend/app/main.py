from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import Base, engine, ensure_schema

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
Base.metadata.create_all(bind=engine)
ensure_schema()

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
