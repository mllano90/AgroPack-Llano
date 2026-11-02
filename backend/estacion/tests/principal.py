"""App mínima solo para las pruebas del módulo. AgroPack no la arranca."""
from fastapi import FastAPI

from estacion.integracion import registrar_estacion

app = FastAPI()
registrar_estacion(app)
