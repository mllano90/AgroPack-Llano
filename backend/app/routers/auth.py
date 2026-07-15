# backend/app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import (
    get_password_hash, 
    verify_password, 
    create_access_token,
    get_current_user,
    require_roles,
    get_user_from_token,
)
from app.models.user import User
from app.models.enums import Rol
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.schemas.token import Token

router = APIRouter()

@router.post("/register", response_model=UserResponse)
def register(
    user: UserCreate, 
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    """
    Registro / creación de nuevos usuarios.

    **Flujo recomendado de gestión de usuarios:**
    - Para crear usuarios: usar este endpoint `/register` (protegido).
    - Para listar usuarios: usar `GET /api/auth/users` (solo roles privilegiados).
    - Para ver roles disponibles: usar `GET /api/auth/roles`.

    **Seguridad:**
    - Si la tabla de usuarios está vacía → permite crear el primer usuario (modo bootstrap).
      → Recomendación fuerte: el primer usuario debe tener rol `admin`.
    - Si ya existen usuarios → **solo** usuarios con rol `admin` pueden crear nuevos usuarios.

    Esto soluciona el problema clásico de "no puedo crear el primer admin después de un reset de BD".
    """
    user_count = db.query(User).count()
    is_first_user = user_count == 0

    if not is_first_user:
        # Modo normal: exigir token + rol admin
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Se requiere token de autenticación para registrar usuarios",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = authorization.split(" ", 1)[1].strip()
        current_user = get_user_from_token(token, db)

        if current_user.rol != Rol.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para crear usuarios. Solo usuarios con rol 'admin' pueden hacerlo."
            )

    # Verificar que no exista el username
    existing = db.query(User).filter(User.username == user.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="El usuario ya existe")
    
    hashed_password = get_password_hash(user.password)
    new_user = User(
        username=user.username,
        nombre_completo=user.nombre_completo,
        rol=user.rol,
        hashed_password=hashed_password
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/login", response_model=Token)
def login(
    username: str = Query(default=None),
    password: str = Query(default=None),
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    # Support frontend sending as query params (?username=..&password=..)
    # and curl/Swagger sending as form data.
    if form_data:
        username = username or form_data.username
        password = password or form_data.password

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Username and password are required"
        )

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}


# ============================================================
# User Management Endpoints (for admins / privileged roles)
# ============================================================

@router.get("/me", response_model=UserResponse)
def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """Devuelve la información del usuario actualmente autenticado."""
    return current_user


@router.get("/users", response_model=list[UserResponse])
def list_users(
    rol: Rol | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([Rol.ADMIN]))
):
    """
    Lista todos los usuarios del sistema (opcionalmente filtrado por rol).
    Solo accesible para usuarios con rol admin.
    """
    query = db.query(User)
    if rol:
        query = query.filter(User.rol == rol)
    users = query.order_by(User.id).all()
    return users


@router.get("/roles", response_model=list[str])
def list_available_roles(
    current_user: User = Depends(get_current_user)  # any logged in user can see available roles
):
    """
    Devuelve la lista de roles disponibles en el sistema.
    Útil para formularios de creación de usuarios.
    """
    return [role.value for role in Rol]


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([Rol.ADMIN]))
):
    """
    Actualiza nombre completo o rol de un usuario.
    Solo accesible para roles privilegiados.
    """
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if user_update.nombre_completo is not None:
        db_user.nombre_completo = user_update.nombre_completo
    if user_update.rol is not None:
        db_user.rol = user_update.rol

    db.commit()
    db.refresh(db_user)
    return db_user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([Rol.ADMIN]))
):
    """
    Elimina un usuario del sistema.
    Solo accesible para roles privilegiados.
    """
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    db.delete(db_user)
    db.commit()
    return None
