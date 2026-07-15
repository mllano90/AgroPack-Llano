"""
Restablece la contraseña de un usuario (o crea admin si no existe).

Uso (en el servidor, con venv activo y backend/.env configurado):

  cd C:\\AgroPack-Llano\\backend
  .\\.venv\\Scripts\\Activate.ps1
  python scripts/reset_password.py admin NuevaClave123
  python scripts/reset_password.py admin NuevaClave123 --create
"""
import sys
import os

# Asegurar que app esté en el path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.core.security import get_password_hash, verify_password
from app.models.user import User
from app.models.enums import Rol


def main():
    if len(sys.argv) < 3:
        print("Uso: python scripts/reset_password.py <username> <nueva_password> [--create]")
        print("Ejemplo: python scripts/reset_password.py admin Admin2026!")
        sys.exit(1)

    username = sys.argv[1].strip()
    password = sys.argv[2]
    create_if_missing = "--create" in sys.argv

    db = SessionLocal()
    try:
        users = db.query(User).all()
        print(f"Usuarios en la base ({len(users)}):")
        for u in users:
            print(f"  - id={u.id}  username={u.username!r}  rol={u.rol}")

        user = db.query(User).filter(User.username == username).first()
        if not user:
            if not create_if_missing:
                print(f"\nNo existe el usuario {username!r}.")
                print("Crea uno con: python scripts/reset_password.py admin TuClave --create")
                sys.exit(1)
            user = User(
                username=username,
                nombre_completo="Administrador",
                rol=Rol.ADMIN,
                hashed_password=get_password_hash(password),
            )
            db.add(user)
            db.commit()
            print(f"\nUsuario {username!r} CREADO con la nueva contraseña.")
        else:
            user.hashed_password = get_password_hash(password)
            db.commit()
            print(f"\nContraseña de {username!r} ACTUALIZADA.")

        # Verificar que el hash funciona
        db.refresh(user)
        ok = verify_password(password, user.hashed_password)
        print(f"Verificación del hash: {'OK' if ok else 'FALLO'}")
        print(f"\nYa puedes entrar en la UI con:")
        print(f"  Usuario: {username}")
        print(f"  Contraseña: (la que acabas de poner)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
