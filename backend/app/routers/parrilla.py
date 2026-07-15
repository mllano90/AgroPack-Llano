from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.parrilla import ParrillaCreate, ParrillaResponse
from app.models.inventory import Parrilla

router = APIRouter()

@router.post("/", response_model=ParrillaResponse)
def crear_parrilla(
    data: ParrillaCreate,
    db: Session = Depends(get_db)
):
    nueva = Parrilla(
        numero_parrilla=data.numero_parrilla,
        variedad=data.variedad,
        tipo_cultivo=data.tipo_cultivo,
        cantidad_cajas=data.cantidad_cajas,
        usuario_id=1  # Temporal
    )
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return nueva
