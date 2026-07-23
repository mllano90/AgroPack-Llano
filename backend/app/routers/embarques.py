from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol, Producto, TipoMercado
from app.schemas.embarques import (
    EmbarqueCreate,
    EmbarqueResponse,
    EmbarqueDetalleCreate,
    ManifiestoParseResponse,
    ManifiestoLineaRaw,
    ManifiestoDetalleStock,
    ManifiestoConfirmarRequest,
)
from app.models.inventory import Embarque, EmbarqueDetalle, InventarioFinal, Cliente
from app.utils.manifiesto_parser import extract_pdf_text, parse_manifiesto_text
from app.utils.limon_inv import (
    extra_dict as _extra_dict,
    norm_talla as _norm_talla,
    norm_pres as _norm_pres,
    rows_inv_limon as _rows_inv_limon,
)

router = APIRouter(tags=["Embarques"])

ROLES_EMBARQUE = [Rol.ADMIN, Rol.EMBARQUES]


def _es_detalle_limon(detalle: EmbarqueDetalleCreate) -> bool:
    """Limón si trae presentación o el producto es limón."""
    if _norm_pres(detalle.presentacion):
        return True
    p = detalle.producto
    if p == Producto.LIMON_AMARILLO:
        return True
    return str(getattr(p, "value", p) or "").lower() in ("limon_amarillo",)


def _match_inv_limon(
    db: Session,
    producto: Producto | None,
    presentacion: str | None,
    talla: str | None,
    mercado: TipoMercado | None = None,
):
    """Compat: primera fila con stock > 0, o la primera coincidencia."""
    rows = _rows_inv_limon(db, presentacion, talla, mercado=mercado)
    for r in rows:
        if (r.cantidad_stock or 0) > 0:
            return r
    return rows[0] if rows else None


def _stock_limon(
    db: Session,
    presentacion: str | None,
    talla: str | None,
    mercado: TipoMercado | None = None,
) -> int:
    rows = _rows_inv_limon(db, presentacion, talla, mercado=mercado)
    return sum(int(r.cantidad_stock or 0) for r in rows)


def _descontar_stock_limon(
    db: Session,
    presentacion: str | None,
    talla: str | None,
    cantidad: int,
    mercado: TipoMercado | None = None,
) -> None:
    """Descuenta cantidad repartiendo entre filas que coincidan (mercado preferido)."""
    if cantidad <= 0:
        return
    rows = _rows_inv_limon(db, presentacion, talla, mercado=mercado)
    total = sum(int(r.cantidad_stock or 0) for r in rows)
    if total < cantidad:
        pres_label = f"{presentacion or ''} T{talla or ''}".strip()
        raise HTTPException(
            status_code=400,
            detail=(
                f"No hay suficiente stock de Limón - {pres_label}. "
                f"Disponible: {total}, solicitado: {cantidad}"
            ),
        )
    restante = cantidad
    for inv in rows:
        if restante <= 0:
            break
        disp = int(inv.cantidad_stock or 0)
        if disp <= 0:
            continue
        usar = min(disp, restante)
        inv.cantidad_stock = disp - usar
        inv.fecha_actualizacion = datetime.utcnow()
        restante -= usar
    if restante > 0:
        # no debería ocurrir tras el check de total
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo descontar inventario limón (faltan {restante})",
        )


def _aplicar_detalles_embarque(
    db: Session,
    nuevo_embarque: Embarque,
    detalles: list[EmbarqueDetalleCreate],
) -> None:
    for detalle in detalles:
        cant = int(detalle.cantidad_cajas or 0)
        if cant <= 0:
            raise HTTPException(status_code=400, detail="cantidad_cajas debe ser > 0")

        if _es_detalle_limon(detalle):
            pres = _norm_pres(detalle.presentacion)
            if not pres:
                raise HTTPException(
                    status_code=400,
                    detail="Embarque limón requiere presentación (rpc_12, rpc_18, caja_40lbs, bins_jugo)",
                )
            talla_n = _norm_talla(pres, detalle.talla)
            _descontar_stock_limon(
                db, pres, talla_n, cant, mercado=detalle.mercado
            )
            cpp = detalle.cajas_por_parrilla
            if cpp is None:
                if pres == "bins_jugo":
                    cpp = 1
                elif pres == "caja_40lbs":
                    cpp = 63
                else:
                    cpp = 45  # RPC default 6423
            db.add(
                EmbarqueDetalle(
                    embarque_id=nuevo_embarque.id,
                    producto=Producto.LIMON_AMARILLO,
                    variedad=None,
                    tipo_cultivo=None,
                    mercado=detalle.mercado,
                    cantidad_cajas=cant,
                    presentacion=pres,
                    talla=talla_n,
                    calidad=detalle.calidad,
                    cajas_por_parrilla=int(cpp),
                )
            )
        else:
            inv_final = (
                db.query(InventarioFinal)
                .filter(
                    InventarioFinal.producto == detalle.producto,
                    InventarioFinal.variedad == detalle.variedad,
                    InventarioFinal.tipo_cultivo == detalle.tipo_cultivo,
                    InventarioFinal.mercado == detalle.mercado,
                )
                .first()
            )
            if not inv_final or (inv_final.cantidad_stock or 0) < cant:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No hay suficiente stock de {detalle.producto.value} - "
                        f"{getattr(detalle.variedad, 'value', detalle.variedad)} - "
                        f"{getattr(detalle.tipo_cultivo, 'value', detalle.tipo_cultivo)} - "
                        f"{detalle.mercado.value}. "
                        f"Disponible: {inv_final.cantidad_stock if inv_final else 0}"
                    ),
                )
            inv_final.cantidad_stock = (inv_final.cantidad_stock or 0) - cant
            inv_final.fecha_actualizacion = datetime.utcnow()
            db.add(
                EmbarqueDetalle(
                    embarque_id=nuevo_embarque.id,
                    producto=detalle.producto,
                    variedad=detalle.variedad,
                    tipo_cultivo=detalle.tipo_cultivo,
                    mercado=detalle.mercado,
                    cantidad_cajas=cant,
                )
            )
    db.flush()


def _parse_fecha(s: str | None) -> date | None:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _sugerir_cliente(db: Session, distribuidor: str | None) -> Cliente | None:
    if not distribuidor:
        return None
    name = distribuidor.strip().upper()
    # tokens útiles: GAME CITRUS, FLAVOR KING, etc.
    clientes = db.query(Cliente).filter(Cliente.activo == 1).all()
    for c in clientes:
        blob = f"{c.nombre or ''} {c.empresa or ''}".upper()
        if name in blob or blob in name:
            return c
        for token in ("GAME CITRUS", "FLAVOR KING", "GAME"):
            if token in name and token in blob:
                return c
    # partial word match
    words = [w for w in name.replace(",", " ").split() if len(w) > 3]
    for c in clientes:
        blob = f"{c.nombre or ''} {c.empresa or ''}".upper()
        if any(w in blob for w in words if w not in ("LLC", "DBA", "FARMS", "INC")):
            return c
    return None


@router.post("/", response_model=EmbarqueResponse)
def crear_embarque(
    embarque: EmbarqueCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(ROLES_EMBARQUE)),
):
    cliente = (
        db.query(Cliente)
        .filter(Cliente.id == embarque.cliente_id, Cliente.activo == 1)
        .first()
    )
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado o inactivo")

    nuevo_embarque = Embarque(
        cliente_id=embarque.cliente_id,
        notas=embarque.notas,
        estado="en_transito",
        usuario_id=getattr(current_user, "id", None),
    )
    db.add(nuevo_embarque)
    db.flush()
    _aplicar_detalles_embarque(db, nuevo_embarque, embarque.detalles)
    db.commit()

    return (
        db.query(Embarque)
        .options(joinedload(Embarque.detalles))
        .filter(Embarque.id == nuevo_embarque.id)
        .first()
    )


@router.get("/", response_model=list[EmbarqueResponse])
def listar_embarques(db: Session = Depends(get_db)):
    return db.query(Embarque).options(joinedload(Embarque.detalles)).all()


@router.post("/parse-manifiesto", response_model=ManifiestoParseResponse)
async def parse_manifiesto(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(ROLES_EMBARQUE)),
):
    """
    Sube un PDF de manifiesto (formato Llano Brand), extrae líneas y
    cruza con inventario final (sin descontar todavía).
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Sube un archivo PDF (.pdf)")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacío")
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF demasiado grande (máx 12 MB)")

    try:
        text = extract_pdf_text(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    parsed = parse_manifiesto_text(text)
    if not parsed.lineas_raw and not parsed.detalles:
        raise HTTPException(
            status_code=400,
            detail=(
                "No se pudieron leer líneas de producto del PDF. "
                "Verifica que sea un manifiesto Llano Brand con detalle de bultos."
            ),
        )

    detalles_stock: list[ManifiestoDetalleStock] = []
    puede = True
    for d in parsed.detalles:
        try:
            mercado = TipoMercado(d.get("mercado") or "exportacion")
        except Exception:
            mercado = TipoMercado.EXPORTACION
        pres = d.get("presentacion")
        talla = d.get("talla")
        cant = int(d.get("cantidad_cajas") or 0)
        stock = _stock_limon(db, pres, talla)
        ok = stock >= cant and cant > 0
        if not ok:
            puede = False
        cpp = d.get("cajas_por_parrilla")
        try:
            cpp_i = int(cpp) if cpp is not None else None
        except (TypeError, ValueError):
            cpp_i = None
        detalles_stock.append(
            ManifiestoDetalleStock(
                producto=Producto.LIMON_AMARILLO,
                mercado=mercado,
                cantidad_cajas=cant,
                presentacion=pres,
                talla=talla,
                calidad=d.get("calidad"),
                cajas_por_parrilla=cpp_i,
                stock_disponible=stock,
                suficiente=ok,
            )
        )

    if not detalles_stock:
        puede = False

    cliente = _sugerir_cliente(db, parsed.distribuidor)

    return ManifiestoParseResponse(
        fecha_embarque=parsed.fecha_embarque,
        hora_salida=parsed.hora_salida,
        numero_manifiesto=parsed.numero_manifiesto,
        embarcador=parsed.embarcador,
        distribuidor=parsed.distribuidor,
        lugar=parsed.lugar,
        mercado=parsed.mercado,
        factura=parsed.factura,
        total_bultos_manifiesto=parsed.total_bultos_manifiesto,
        total_bultos_parseados=sum(x.bultos for x in parsed.lineas_raw),
        lineas_raw=[
            ManifiestoLineaRaw(
                no=ln.no,
                bultos=ln.bultos,
                descripcion=ln.descripcion,
                lote=ln.lote,
                etiqueta=ln.etiqueta,
                pallet=ln.pallet,
                presentacion=ln.presentacion,
                talla=ln.talla,
                calidad=ln.calidad,
                parse_ok=ln.parse_ok,
                parse_note=ln.parse_note,
            )
            for ln in parsed.lineas_raw
        ],
        detalles=detalles_stock,
        warnings=parsed.warnings,
        puede_confirmar=puede,
        cliente_sugerido_id=cliente.id if cliente else None,
        cliente_sugerido_nombre=(
            f"{cliente.nombre}" + (f" ({cliente.empresa})" if cliente and cliente.empresa else "")
            if cliente
            else None
        ),
    )


@router.post("/desde-manifiesto", response_model=EmbarqueResponse)
def confirmar_manifiesto(
    body: ManifiestoConfirmarRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(ROLES_EMBARQUE)),
):
    """
    Confirma el embarque con las líneas del manifiesto y descuenta inventario.
    """
    if not body.detalles:
        raise HTTPException(status_code=400, detail="No hay detalles para embarcar")

    cliente = (
        db.query(Cliente)
        .filter(Cliente.id == body.cliente_id, Cliente.activo == 1)
        .first()
    )
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado o inactivo")

    fecha = _parse_fecha(body.fecha_embarque)
    notas_parts = []
    if body.notas:
        notas_parts.append(body.notas)
    notas_parts.append("Origen: manifiesto PDF")
    notas = " | ".join(notas_parts)

    nuevo_embarque = Embarque(
        cliente_id=body.cliente_id,
        notas=notas,
        estado="en_transito",
        usuario_id=getattr(current_user, "id", None),
    )
    if fecha:
        nuevo_embarque.fecha_salida = fecha
    db.add(nuevo_embarque)
    db.flush()
    _aplicar_detalles_embarque(db, nuevo_embarque, body.detalles)
    db.commit()

    return (
        db.query(Embarque)
        .options(joinedload(Embarque.detalles))
        .filter(Embarque.id == nuevo_embarque.id)
        .first()
    )
