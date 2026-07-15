# backend/app/schemas/user.py
from pydantic import BaseModel, EmailStr
from app.models.enums import Rol

class UserBase(BaseModel):
    username: str
    nombre_completo: str
    rol: Rol

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    nombre_completo: str | None = None
    rol: Rol | None = None
    # Nota: Para cambiar contraseña se recomienda un endpoint separado en el futuro