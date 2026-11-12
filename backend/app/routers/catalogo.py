"""CRUD y operación de productos nuevos.

Uva, limón y melón no pasan por aquí. Sus tablas no se leen ni se escriben.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.catalogo import (
    CatalogoEmbarque,
    CatalogoEmbarqueLinea,
    CatalogoEmpaque,
    CatalogoInventarioCampo,
    CatalogoInventarioFinal,
    CatalogoRecepcion,
    ProductoCatalogo,
    ProductoParametro,
    TipoCajaCatalogo,
    TipoCosechaCatalogo,
)
from app.models.enums import Rol
from app.models.inventory import Cliente
from app.schemas.catalogo import (
    ActivoIn,
    ConfigIn,
    EmbarqueIn,
    EmpaqueIn,
    NombreIn,
    RecepcionIn,
)

router = APIRouter()

ROLES_RECEPCION = [Rol.ADMIN, Rol.RECEPCION, Rol.RECEPCION_EMPACADOR]
ROLES_EMPAQUE = [Rol.ADMIN, Rol.EMPACADOR, Rol.RECEPCION_EMPACADOR]
ROLES_EMBARQUE = [Rol.ADMIN, Rol.EMBARQUES]

# Opciones fijas de cosecha. No se insertan: ya existen como concepto de limón/melón/uva.
COSECHAS_FIJAS = (
    {"codigo": "bins", "nombre": "Bin", "fijo": True},
    {"codigo": "cajas_campo", "nombre": "Caja de campo", "fijo": True},
)
_CODIGOS_FIJOS = {c["codigo"] for c in COSECHAS_FIJAS}
_NOMBRES_FIJOS = {c["nombre"] for c in COSECHAS_FIJAS}

RESERVADOS_PRODUCTO = {"uva", "melon", "limon", "limon_amarillo"}


def _slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return (s or "item")[:48]


def _unico(db: Session, model, base: str) -> str:
    code = base
    n = 2
    while db.query(model).filter(model.codigo == code).first():
        suffix = f"_{n}"
        code = f"{base[: 48 - len(suffix)]}{suffix}"
        n += 1
    return code


def _es_admin(user) -> bool:
    rol = user.rol
    if rol == Rol.ADMIN:
        return True
    return str(getattr(rol, "value", rol)).lower() == Rol.ADMIN.value


def _as_list(raw) -> list:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "[]")
        except json.JSONDecodeError:
            return []
    return raw if isinstance(raw, list) else []


def _r2(n: float) -> float:
    return round(float(n), 2)


def _r4(n: float) -> float:
    return round(float(n), 4)


def _nombre_cosecha(db: Session, codigo: str) -> str:
    for fijo in COSECHAS_FIJAS:
        if fijo["codigo"] == codigo:
            return fijo["nombre"]
    row = db.query(TipoCosechaCatalogo).filter(TipoCosechaCatalogo.codigo == codigo).first()
    return row.nombre if row else codigo


def _producto(db: Session, producto_id: int) -> ProductoCatalogo:
    prod = db.query(ProductoCatalogo).filter(ProductoCatalogo.id == producto_id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return prod


def _parametros(db: Session, producto_id: int) -> list[ProductoParametro]:
    return (
        db.query(ProductoParametro)
        .filter(ProductoParametro.producto_id == producto_id)
        .order_by(ProductoParametro.calidad, ProductoParametro.id)
        .all()
    )


def _tipos_por_id(db: Session, ids: list[int]) -> dict[int, TipoCajaCatalogo]:
    if not ids:
        return {}
    rows = db.query(TipoCajaCatalogo).filter(TipoCajaCatalogo.id.in_(set(ids))).all()
    return {r.id: r for r in rows}


def _out_producto(db: Session, prod: ProductoCatalogo) -> dict:
    params = _parametros(db, prod.id)
    tipos = _tipos_por_id(db, [p.tipo_caja_id for p in params])
    peso = float(prod.peso_contenedor_kg) if prod.peso_contenedor_kg is not None else None
    return {
        "id": prod.id,
        "codigo": prod.codigo,
        "nombre": prod.nombre,
        "tipo_cosecha": prod.tipo_cosecha,
        "tipo_cosecha_nombre": _nombre_cosecha(db, prod.tipo_cosecha),
        "peso_contenedor_kg": peso,
        "hectareas": float(prod.hectareas) if prod.hectareas is not None else None,
        "activo": bool(prod.activo),
        "configurado": bool(peso and peso > 0 and params),
        "parametros": [
            {
                "id": p.id,
                "calidad": p.calidad,
                "tipo_caja_id": p.tipo_caja_id,
                "tipo_caja": tipos[p.tipo_caja_id].nombre if p.tipo_caja_id in tipos else "",
                "kg": float(p.kg),
                "cajas_por_parrilla": int(p.cajas_por_parrilla),
            }
            for p in params
        ],
    }


def _exigir_operable(prod: ProductoCatalogo, params: list[ProductoParametro]) -> None:
    if not prod.activo:
        raise HTTPException(status_code=400, detail="El producto está inactivo")
    if not prod.peso_contenedor_kg or float(prod.peso_contenedor_kg) <= 0 or not params:
        raise HTTPException(
            status_code=400,
            detail="Termina de configurar el producto en Ajustes generales (cosecha, peso y cajas)",
        )


def _param_usado(db: Session, producto_id: int, tipo_caja_id: int, calidad: str) -> bool:
    if (
        db.query(CatalogoInventarioFinal)
        .filter_by(producto_id=producto_id, tipo_caja_id=tipo_caja_id, calidad=calidad)
        .first()
    ):
        return True
    if (
        db.query(CatalogoEmbarqueLinea)
        .filter_by(producto_id=producto_id, tipo_caja_id=tipo_caja_id, calidad=calidad)
        .first()
    ):
        return True
    for emp in db.query(CatalogoEmpaque).filter_by(producto_id=producto_id).all():
        for lin in _as_list(emp.lineas):
            if int(lin.get("tipo_caja_id") or 0) == tipo_caja_id and str(lin.get("calidad") or "") == calidad:
                return True
    return False


def _tiene_movimientos(db: Session, producto_id: int) -> bool:
    if db.query(CatalogoRecepcion).filter_by(producto_id=producto_id).first():
        return True
    if db.query(CatalogoEmpaque).filter_by(producto_id=producto_id).first():
        return True
    if db.query(CatalogoEmbarqueLinea).filter_by(producto_id=producto_id).first():
        return True
    return False


@router.get("/tipos-cosecha")
def listar_tipos_cosecha(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    propios = (
        db.query(TipoCosechaCatalogo).order_by(TipoCosechaCatalogo.nombre).all()
    )
    out = [dict(c) for c in COSECHAS_FIJAS]
    for row in propios:
        out.append({"id": row.id, "codigo": row.codigo, "nombre": row.nombre, "fijo": False})
    return out


@router.post("/tipos-cosecha")
def crear_tipo_cosecha(
    body: NombreIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    base = _slug(body.nombre)
    if base in _CODIGOS_FIJOS or body.nombre.lower() in {n.lower() for n in _NOMBRES_FIJOS} or _slug(body.nombre) in {
        _slug(n) for n in _NOMBRES_FIJOS
    }:
        raise HTTPException(
            status_code=400,
            detail="Bin y Caja de campo ya están en la lista. Elige otro nombre.",
        )
    existe = (
        db.query(TipoCosechaCatalogo)
        .filter(TipoCosechaCatalogo.nombre.ilike(body.nombre))
        .first()
    )
    if existe:
        raise HTTPException(status_code=400, detail="Ese contenedor de cosecha ya está registrado")
    row = TipoCosechaCatalogo(
        codigo=_unico(db, TipoCosechaCatalogo, base),
        nombre=body.nombre,
        fecha_creacion=datetime.utcnow(),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Ese contenedor de cosecha ya está registrado")
    db.refresh(row)
    return {"id": row.id, "codigo": row.codigo, "nombre": row.nombre, "fijo": False}


@router.get("/tipos-caja")
def listar_tipos_caja(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rows = db.query(TipoCajaCatalogo).order_by(TipoCajaCatalogo.nombre).all()
    return [{"id": r.id, "codigo": r.codigo, "nombre": r.nombre} for r in rows]


@router.post("/tipos-caja")
def crear_tipo_caja(
    body: NombreIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    existe = (
        db.query(TipoCajaCatalogo).filter(TipoCajaCatalogo.nombre.ilike(body.nombre)).first()
    )
    if existe:
        raise HTTPException(status_code=400, detail="Ese tipo de caja ya está registrado")
    row = TipoCajaCatalogo(
        codigo=_unico(db, TipoCajaCatalogo, _slug(body.nombre)),
        nombre=body.nombre,
        fecha_creacion=datetime.utcnow(),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Ese tipo de caja ya está registrado")
    db.refresh(row)
    return {"id": row.id, "codigo": row.codigo, "nombre": row.nombre}


@router.get("/productos")
def listar_productos(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(ProductoCatalogo)
    if not _es_admin(current_user):
        q = q.filter(ProductoCatalogo.activo == 1)
    rows = q.order_by(ProductoCatalogo.nombre).all()
    return [_out_producto(db, p) for p in rows]


@router.post("/productos")
def crear_producto(
    body: NombreIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    base = _slug(body.nombre)
    if base in RESERVADOS_PRODUCTO:
        raise HTTPException(
            status_code=400,
            detail="Ese nombre está reservado (uva, limón o melón). Elige otro.",
        )
    prod = ProductoCatalogo(
        codigo=_unico(db, ProductoCatalogo, base),
        nombre=body.nombre,
        tipo_cosecha="bins",
        peso_contenedor_kg=None,
        hectareas=None,
        activo=1,
        fecha_creacion=datetime.utcnow(),
    )
    db.add(prod)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="No se pudo registrar el producto")
    db.refresh(prod)
    return _out_producto(db, prod)


@router.get("/productos/{producto_id}")
def obtener_producto(
    producto_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return _out_producto(db, _producto(db, producto_id))


@router.put("/productos/{producto_id}")
def configurar_producto(
    producto_id: int,
    body: ConfigIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    prod = _producto(db, producto_id)
    codigo = body.tipo_cosecha
    if codigo not in _CODIGOS_FIJOS:
        if not db.query(TipoCosechaCatalogo).filter_by(codigo=codigo).first():
            raise HTTPException(status_code=400, detail="El tipo de cosecha no está registrado")
    caja_ids = {p.tipo_caja_id for p in body.parametros}
    encontrados = {
        r.id
        for r in db.query(TipoCajaCatalogo).filter(TipoCajaCatalogo.id.in_(caja_ids)).all()
    }
    if encontrados != caja_ids:
        raise HTTPException(status_code=400, detail="Hay un tipo de caja que no existe")

    actuales = {(p.calidad, p.tipo_caja_id): p for p in _parametros(db, prod.id)}
    conservados: set[tuple[str, int]] = set()
    for item in body.parametros:
        key = (item.calidad, item.tipo_caja_id)
        row = actuales.get(key)
        if row:
            row.kg = float(item.kg)
            row.cajas_por_parrilla = int(item.cajas_por_parrilla)
        else:
            db.add(
                ProductoParametro(
                    producto_id=prod.id,
                    calidad=item.calidad,
                    tipo_caja_id=item.tipo_caja_id,
                    kg=float(item.kg),
                    cajas_por_parrilla=int(item.cajas_por_parrilla),
                )
            )
        conservados.add(key)
    for key, row in actuales.items():
        if key in conservados:
            continue
        if _param_usado(db, prod.id, key[1], key[0]):
            raise HTTPException(
                status_code=409,
                detail="No se puede quitar un tipo de caja que ya tiene empaque, inventario o embarques",
            )
        db.delete(row)

    prod.tipo_cosecha = codigo
    prod.peso_contenedor_kg = float(body.peso_contenedor_kg)
    prod.hectareas = float(body.hectareas) if body.hectareas is not None else None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="No se pudo guardar la configuración")
    db.refresh(prod)
    return _out_producto(db, prod)


@router.patch("/productos/{producto_id}/activo")
def cambiar_activo(
    producto_id: int,
    body: ActivoIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    prod = _producto(db, producto_id)
    prod.activo = 1 if body.activo else 0
    db.commit()
    db.refresh(prod)
    return _out_producto(db, prod)


@router.delete("/productos/{producto_id}")
def eliminar_producto(
    producto_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    prod = _producto(db, producto_id)
    if _tiene_movimientos(db, prod.id):
        raise HTTPException(
            status_code=409,
            detail="Este producto ya tiene recepciones, empaques o embarques. Desactívalo en lugar de borrarlo.",
        )
    db.query(CatalogoInventarioCampo).filter_by(producto_id=prod.id).delete(synchronize_session=False)
    db.query(CatalogoInventarioFinal).filter_by(producto_id=prod.id).delete(synchronize_session=False)
    db.query(ProductoParametro).filter_by(producto_id=prod.id).delete(synchronize_session=False)
    db.delete(prod)
    db.commit()
    return {"ok": True}


@router.post("/recepciones")
def crear_recepcion(
    body: RecepcionIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(ROLES_RECEPCION)),
):
    prod = _producto(db, body.producto_id)
    params = _parametros(db, prod.id)
    _exigir_operable(prod, params)
    lote = (body.lote or "").strip() or "General"
    rec = CatalogoRecepcion(
        producto_id=prod.id,
        fecha=body.fecha or date.today(),
        lote=lote,
        cantidad=int(body.cantidad),
        usuario_id=getattr(current_user, "id", None),
        notas=(body.notas or None),
    )
    db.add(rec)
    inv = (
        db.query(CatalogoInventarioCampo)
        .filter_by(producto_id=prod.id, lote=lote)
        .first()
    )
    if inv:
        inv.cantidad_disponible = int(inv.cantidad_disponible or 0) + int(body.cantidad)
    else:
        inv = CatalogoInventarioCampo(
            producto_id=prod.id,
            lote=lote,
            cantidad_disponible=int(body.cantidad),
        )
        db.add(inv)
    db.commit()
    db.refresh(rec)
    db.refresh(inv)
    return {
        "id": rec.id,
        "producto_id": prod.id,
        "lote": lote,
        "cantidad": rec.cantidad,
        "fecha": rec.fecha.isoformat(),
        "cantidad_disponible": int(inv.cantidad_disponible),
    }


@router.get("/campo")
def listar_campo(
    producto_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _producto(db, producto_id)
    rows = (
        db.query(CatalogoInventarioCampo)
        .filter(
            CatalogoInventarioCampo.producto_id == producto_id,
            CatalogoInventarioCampo.cantidad_disponible > 0,
        )
        .order_by(CatalogoInventarioCampo.lote)
        .all()
    )
    return [
        {
            "producto_id": r.producto_id,
            "lote": r.lote,
            "cantidad_disponible": int(r.cantidad_disponible or 0),
        }
        for r in rows
    ]


@router.post("/empaques")
def crear_empaque(
    body: EmpaqueIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(ROLES_EMPAQUE)),
):
    prod = _producto(db, body.producto_id)
    params = {p.id: p for p in _parametros(db, prod.id)}
    _exigir_operable(prod, list(params.values()))
    lote = body.lote.strip()
    campo = (
        db.query(CatalogoInventarioCampo)
        .filter_by(producto_id=prod.id, lote=lote)
        .first()
    )
    disponible = int(campo.cantidad_disponible) if campo else 0
    if disponible < int(body.cantidad_campo):
        raise HTTPException(
            status_code=400,
            detail=f"No hay suficientes contenedores en el lote {lote} (disponibles: {disponible})",
        )
    lineas_out = []
    for lin in body.lineas:
        param = params.get(lin.parametro_id)
        if not param:
            raise HTTPException(
                status_code=400,
                detail="La presentación no pertenece a este producto",
            )
        lineas_out.append(
            {
                "parametro_id": param.id,
                "tipo_caja_id": param.tipo_caja_id,
                "calidad": param.calidad,
                "cantidad": int(lin.cantidad),
            }
        )
    campo.cantidad_disponible = disponible - int(body.cantidad_campo)
    emp = CatalogoEmpaque(
        producto_id=prod.id,
        fecha=body.fecha or date.today(),
        lote=lote,
        cantidad_campo=int(body.cantidad_campo),
        lineas=lineas_out,
        usuario_id=getattr(current_user, "id", None),
    )
    db.add(emp)
    for lin in lineas_out:
        inv = (
            db.query(CatalogoInventarioFinal)
            .filter_by(
                producto_id=prod.id,
                tipo_caja_id=lin["tipo_caja_id"],
                calidad=lin["calidad"],
                lote=lote,
            )
            .first()
        )
        if inv:
            inv.cantidad_stock = int(inv.cantidad_stock or 0) + lin["cantidad"]
        else:
            db.add(
                CatalogoInventarioFinal(
                    producto_id=prod.id,
                    tipo_caja_id=lin["tipo_caja_id"],
                    calidad=lin["calidad"],
                    lote=lote,
                    cantidad_stock=lin["cantidad"],
                )
            )
    db.commit()
    db.refresh(emp)
    return {
        "id": emp.id,
        "producto_id": prod.id,
        "lote": lote,
        "cantidad_campo": emp.cantidad_campo,
        "fecha": emp.fecha.isoformat(),
        "lineas": lineas_out,
        "campo_restante": int(campo.cantidad_disponible),
    }


@router.get("/inventario")
def listar_inventario(
    producto_id: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(CatalogoInventarioFinal).filter(CatalogoInventarioFinal.cantidad_stock > 0)
    if producto_id is not None:
        q = q.filter(CatalogoInventarioFinal.producto_id == producto_id)
    rows = q.order_by(CatalogoInventarioFinal.producto_id, CatalogoInventarioFinal.id).all()
    if not rows:
        return []
    prod_ids = {r.producto_id for r in rows}
    caja_ids = {r.tipo_caja_id for r in rows}
    productos = {
        p.id: p
        for p in db.query(ProductoCatalogo).filter(ProductoCatalogo.id.in_(prod_ids)).all()
    }
    tipos = _tipos_por_id(db, list(caja_ids))
    params = (
        db.query(ProductoParametro)
        .filter(ProductoParametro.producto_id.in_(prod_ids))
        .all()
    )
    por_sku = {(p.producto_id, p.tipo_caja_id, p.calidad): p for p in params}
    out = []
    for r in rows:
        param = por_sku.get((r.producto_id, r.tipo_caja_id, r.calidad))
        prod = productos.get(r.producto_id)
        tipo = tipos.get(r.tipo_caja_id)
        out.append(
            {
                "id": r.id,
                "producto_id": r.producto_id,
                "producto": prod.nombre if prod else "",
                "codigo": prod.codigo if prod else "",
                "tipo_caja_id": r.tipo_caja_id,
                "tipo_caja": tipo.nombre if tipo else "",
                "calidad": r.calidad,
                "lote": r.lote,
                "cantidad_stock": int(r.cantidad_stock or 0),
                "kg": float(param.kg) if param else None,
                "cajas_por_parrilla": int(param.cajas_por_parrilla) if param else None,
            }
        )
    return out


@router.post("/embarques")
def crear_embarque(
    body: EmbarqueIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(ROLES_EMBARQUE)),
):
    cliente = db.query(Cliente).filter(Cliente.id == body.cliente_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    necesidad: dict[int, int] = defaultdict(int)
    inventarios: dict[int, CatalogoInventarioFinal] = {}
    for lin in body.lineas:
        inv = db.query(CatalogoInventarioFinal).filter_by(id=lin.inventario_id).first()
        if not inv:
            raise HTTPException(status_code=404, detail=f"Inventario {lin.inventario_id} no encontrado")
        necesidad[inv.id] += int(lin.cantidad)
        inventarios[inv.id] = inv
    for iid, cant in necesidad.items():
        tengo = int(inventarios[iid].cantidad_stock or 0)
        if tengo < cant:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente (disponibles: {tengo}, pedidos: {cant})",
            )
    emb = CatalogoEmbarque(
        fecha_salida=body.fecha or date.today(),
        cliente_id=cliente.id,
        notas=(body.notas or None),
        usuario_id=getattr(current_user, "id", None),
    )
    db.add(emb)
    db.flush()
    lineas_out = []
    for iid, cant in necesidad.items():
        inv = inventarios[iid]
        inv.cantidad_stock = int(inv.cantidad_stock or 0) - cant
        param = (
            db.query(ProductoParametro)
            .filter_by(
                producto_id=inv.producto_id,
                tipo_caja_id=inv.tipo_caja_id,
                calidad=inv.calidad,
            )
            .first()
        )
        db.add(
            CatalogoEmbarqueLinea(
                embarque_id=emb.id,
                producto_id=inv.producto_id,
                tipo_caja_id=inv.tipo_caja_id,
                calidad=inv.calidad,
                lote=inv.lote or "",
                cantidad=cant,
                cajas_por_parrilla=int(param.cajas_por_parrilla) if param else None,
            )
        )
        lineas_out.append(
            {
                "inventario_id": inv.id,
                "producto_id": inv.producto_id,
                "tipo_caja_id": inv.tipo_caja_id,
                "calidad": inv.calidad,
                "lote": inv.lote,
                "cantidad": cant,
                "cantidad_restante": int(inv.cantidad_stock),
            }
        )
    db.commit()
    return {
        "id": emb.id,
        "cliente_id": cliente.id,
        "fecha_salida": emb.fecha_salida.isoformat(),
        "notas": emb.notas,
        "lineas": lineas_out,
    }


@router.get("/embarques")
def listar_embarques(
    producto_id: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(CatalogoEmbarqueLinea)
    if producto_id is not None:
        q = q.filter(CatalogoEmbarqueLinea.producto_id == producto_id)
    lineas = q.order_by(CatalogoEmbarqueLinea.id).all()
    if not lineas:
        return []
    emb_ids = {ln.embarque_id for ln in lineas}
    embs = {
        e.id: e
        for e in db.query(CatalogoEmbarque).filter(CatalogoEmbarque.id.in_(emb_ids)).all()
    }
    clientes = {
        c.id: c
        for c in db.query(Cliente).filter(Cliente.id.in_({e.cliente_id for e in embs.values()})).all()
    }
    tipos = _tipos_por_id(db, [ln.tipo_caja_id for ln in lineas])
    productos = {
        p.id: p
        for p in db.query(ProductoCatalogo)
        .filter(ProductoCatalogo.id.in_({ln.producto_id for ln in lineas}))
        .all()
    }
    agrupado: dict[int, dict] = {}
    for ln in lineas:
        emb = embs.get(ln.embarque_id)
        if not emb:
            continue
        slot = agrupado.get(emb.id)
        if not slot:
            cli = clientes.get(emb.cliente_id)
            slot = {
                "id": emb.id,
                "fecha_salida": emb.fecha_salida.isoformat() if emb.fecha_salida else None,
                "cliente_id": emb.cliente_id,
                "cliente": cli.nombre if cli else "",
                "notas": emb.notas,
                "lineas": [],
            }
            agrupado[emb.id] = slot
        tipo = tipos.get(ln.tipo_caja_id)
        prod = productos.get(ln.producto_id)
        slot["lineas"].append(
            {
                "producto_id": ln.producto_id,
                "producto": prod.nombre if prod else "",
                "tipo_caja": tipo.nombre if tipo else "",
                "calidad": ln.calidad,
                "lote": ln.lote,
                "cantidad": int(ln.cantidad),
                "cajas_por_parrilla": ln.cajas_por_parrilla,
            }
        )
    return list(agrupado.values())


@router.get("/reportes/{producto_id}")
def reporte_producto(
    producto_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    prod = _producto(db, producto_id)
    data = _out_producto(db, prod)
    params = {p.id: p for p in _parametros(db, prod.id)}
    por_sku = {(p.tipo_caja_id, p.calidad): p for p in params.values()}
    tipos = _tipos_por_id(db, [p.tipo_caja_id for p in params.values()])

    recepciones = db.query(CatalogoRecepcion).filter_by(producto_id=prod.id).all()
    contenedores = sum(int(r.cantidad or 0) for r in recepciones)
    peso = float(prod.peso_contenedor_kg or 0)
    kg_campo = contenedores * peso

    kg1 = 0.0
    kg2 = 0.0
    # (tipo_caja_id, calidad) -> cajas
    cajas: dict[tuple[int, str], int] = defaultdict(int)
    empaques = (
        db.query(CatalogoEmpaque)
        .filter_by(producto_id=prod.id)
        .order_by(CatalogoEmpaque.fecha, CatalogoEmpaque.id)
        .all()
    )
    empaques_out = []
    for emp in empaques:
        lineas = _as_list(emp.lineas)
        det = []
        for lin in lineas:
            tipo_id = int(lin.get("tipo_caja_id") or 0)
            calidad = str(lin.get("calidad") or "")
            cant = int(lin.get("cantidad") or 0)
            param = params.get(int(lin.get("parametro_id") or 0)) or por_sku.get((tipo_id, calidad))
            kg_u = float(param.kg) if param else 0.0
            kg = cant * kg_u
            if calidad == "segunda":
                kg2 += kg
            else:
                kg1 += kg
            cajas[(tipo_id, calidad)] += cant
            tipo = tipos.get(tipo_id)
            det.append(
                {
                    "tipo_caja": tipo.nombre if tipo else "",
                    "calidad": calidad,
                    "cantidad": cant,
                    "kg": _r2(kg),
                }
            )
        empaques_out.append(
            {
                "id": emp.id,
                "fecha": emp.fecha.isoformat() if emp.fecha else None,
                "lote": emp.lote,
                "cantidad_campo": int(emp.cantidad_campo or 0),
                "lineas": det,
            }
        )

    ha = float(prod.hectareas) if prod.hectareas else None

    def _fila(tipo_id: int, calidad: str, base_kg: float) -> dict:
        param = por_sku.get((tipo_id, calidad))
        cant = cajas.get((tipo_id, calidad), 0)
        kg_u = float(param.kg) if param else 0.0
        cpp = int(param.cajas_por_parrilla) if param else 0
        kg = cant * kg_u
        tipo = tipos.get(tipo_id)
        return {
            "tipo_caja_id": tipo_id,
            "nombre": tipo.nombre if tipo else "",
            "calidad": calidad,
            "kg_caja": kg_u,
            "cajas_por_parrilla": cpp,
            "cajas": cant,
            "kg": _r2(kg),
            "parrillas": _r4(cant / cpp) if cpp else 0.0,
            "pct": _r2(kg / base_kg * 100) if base_kg else 0.0,
        }

    ids_1 = sorted({tid for (tid, cal) in list(por_sku.keys()) + list(cajas.keys()) if cal != "segunda"})
    ids_2 = sorted({tid for (tid, cal) in list(por_sku.keys()) + list(cajas.keys()) if cal == "segunda"})
    # Include configured presentations even with 0 cajas, and any historical tipo still in cajas.
    vistos_1 = []
    for p in params.values():
        if p.calidad != "segunda" and p.tipo_caja_id not in {x["tipo_caja_id"] for x in vistos_1}:
            vistos_1.append(_fila(p.tipo_caja_id, "primera", kg1))
    for tid in ids_1:
        if tid not in {x["tipo_caja_id"] for x in vistos_1}:
            vistos_1.append(_fila(tid, "primera", kg1))
    vistos_2 = []
    for p in params.values():
        if p.calidad == "segunda" and p.tipo_caja_id not in {x["tipo_caja_id"] for x in vistos_2}:
            vistos_2.append(_fila(p.tipo_caja_id, "segunda", kg2))
    for tid in ids_2:
        if tid not in {x["tipo_caja_id"] for x in vistos_2}:
            vistos_2.append(_fila(tid, "segunda", kg2))

    parrillas_1 = sum(float(f["parrillas"]) for f in vistos_1)
    campo_rows = (
        db.query(CatalogoInventarioCampo)
        .filter_by(producto_id=prod.id)
        .order_by(CatalogoInventarioCampo.lote)
        .all()
    )
    inventario = listar_inventario(producto_id=prod.id, db=db, current_user=current_user)
    embarques = listar_embarques(producto_id=prod.id, db=db, current_user=current_user)

    return {
        **data,
        "contenedores": contenedores,
        "kg_campo": _r2(kg_campo),
        "kg_primera": _r2(kg1),
        "kg_segunda": _r2(kg2),
        "pct_primera": _r2(kg1 / kg_campo * 100) if kg_campo else 0.0,
        "pct_segunda": _r2(kg2 / kg_campo * 100) if kg_campo else 0.0,
        "kg_primera_por_ha": _r2(kg1 / ha) if ha else None,
        "kg_segunda_por_ha": _r2(kg2 / ha) if ha else None,
        "ton_por_ha": _r4((kg1 + kg2) / 1000 / ha) if ha else None,
        "parrillas_primera": _r4(parrillas_1),
        "contenedores_por_parrilla": _r4(contenedores / parrillas_1) if parrillas_1 else None,
        "por_presentacion_primera": vistos_1,
        "por_presentacion_segunda": vistos_2,
        "campo": [
            {"lote": r.lote, "cantidad_disponible": int(r.cantidad_disponible or 0)}
            for r in campo_rows
        ],
        "inventario_final": inventario,
        "empaques": empaques_out,
        "embarques": embarques,
    }
