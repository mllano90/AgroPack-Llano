from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import require_roles
from app.models.inventory import Cliente
from app.models.enums import Rol
from app.schemas.cliente import ClienteCreate, ClienteUpdate, ClienteResponse

router = APIRouter(tags=["Clientes"])


@router.post("/", response_model=ClienteResponse, status_code=status.HTTP_201_CREATED)
def crear_cliente(
    cliente: ClienteCreate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN]))
):
    """
    Crear cliente.
    Protegido: solo usuarios con rol admin pueden crear, editar o eliminar clientes.
    (Los endpoints de lectura siguen abiertos para que el selector de Embarques funcione.)
    """
    db_cliente = Cliente(**cliente.model_dump())
    db.add(db_cliente)
    db.commit()
    db.refresh(db_cliente)
    return db_cliente


@router.get("/", response_model=List[ClienteResponse])
def listar_clientes(activos: bool = True, db: Session = Depends(get_db)):
    query = db.query(Cliente)
    if activos:
        query = query.filter(Cliente.activo == 1)
    return query.order_by(Cliente.nombre).all()


@router.get("/{cliente_id}", response_model=ClienteResponse)
def obtener_cliente(cliente_id: int, db: Session = Depends(get_db)):
    cliente = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return cliente


@router.put("/{cliente_id}", response_model=ClienteResponse)
def actualizar_cliente(
    cliente_id: int, 
    cliente: ClienteUpdate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN]))
):
    """Actualizar cliente — protegido (mismo rol que creación)."""
    db_cliente = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not db_cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    update_data = cliente.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_cliente, key, value)

    db.commit()
    db.refresh(db_cliente)
    return db_cliente


@router.delete("/{cliente_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_cliente(
    cliente_id: int, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN]))
):
    """Eliminar (soft-delete) cliente — protegido."""
    db_cliente = db.query(Cliente).filter(Cliente.id == cliente_id).first()
    if not db_cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # Soft delete por defecto
    db_cliente.activo = 0
    db.commit()
    return None
