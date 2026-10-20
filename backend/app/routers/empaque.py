from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from datetime import datetime, date as date_cls
from app.schemas.empaque import (
    EmpaqueCreate,
    EmpaqueResponse,
    AgregarConsumoRequest,
    AnularEmpaqueResponse,
    EliminarEmpaqueResponse,
    EmpaqueEditRequest,
    ConvertirGranelRequest,
    ConvertirGranelResponse,
)
from app.models.enums import TipoMercado
from app.models.inventory import Empaque, InventarioCampo, InventarioFinal, InventarioDesverdizado
from app.models.enums import Producto
from app.models.enums import Producto as ProductoEnum
from app.utils.limon_inv import (
    norm_talla as _talla_for_pres,
    norm_lote as _norm_lote_extra,
    norm_fecha_empaque as _norm_fecha_emp,
    calidad_pres as _calidad_pres,
    extra_dict as _extra_dict,
    find_inv_final_limon as _find_inv_final_limon,
    rows_inv_limon as _rows_inv_limon,
    stock_limon as _stock_limon,
    parse_detalle_corrida as _detalle_as_dict,
)

router = APIRouter(tags=["Empaque"])


def _norm_lote(lote: str | None) -> str:
    return (lote or "").strip()


def _sync_legacy_empaque_fields(
    emp: Empaque,
    *,
    produccion: list | None,
    consumos: list | None,
    bins_usados: int | None = None,
) -> None:
    """
    Mantiene columnas legacy (presentacion/talla/cantidad_producida/lote)
    alineadas con detalle_corrida para reportes y listados antiguos.
    """
    prod = produccion or []
    cons = consumos or []
    if bins_usados is not None:
        emp.bins_desverdizado_usados = int(bins_usados)
    elif cons:
        emp.bins_desverdizado_usados = sum(int(c.get("bins") or 0) for c in cons if isinstance(c, dict))

    if cons:
        first_lote = next(
            (str(c.get("lote")).strip() for c in cons if isinstance(c, dict) and c.get("lote")),
            None,
        )
        if first_lote:
            emp.lote_desverdizado = first_lote

    total_cant = 0
    first_pres = None
    first_talla = None
    for p in prod:
        if not isinstance(p, dict):
            continue
        cant = int(p.get("cantidad") or 0)
        if cant <= 0:
            continue
        total_cant += cant
        if first_pres is None:
            first_pres = (p.get("presentacion") or "").strip() or None
            first_talla = _talla_for_pres(first_pres, p.get("talla"))
    if total_cant > 0:
        emp.cantidad_producida = total_cant
    if first_pres:
        emp.presentacion = first_pres
        emp.talla = first_talla
        emp.calidad = _calidad_pres(first_pres)


def _match_desverdizado_por_lote(
    db: Session, lote: str, producto: Producto | None = None
) -> list:
    """Filas de desverdizado del lote (match exacto o sin distinguir espacios/mayúsculas)."""
    lote_n = _norm_lote(lote)
    if not lote_n:
        return []
    q = db.query(InventarioDesverdizado)
    if producto is not None:
        q = q.filter(InventarioDesverdizado.producto == producto)
    else:
        q = q.filter(InventarioDesverdizado.producto == Producto.LIMON_AMARILLO)
    rows = q.order_by(
        InventarioDesverdizado.fecha_recepcion.asc(),
        InventarioDesverdizado.id.asc(),
    ).all()
    # Legacy limón: si no hay filas con enum, buscar sin filtrar producto
    if not rows and producto in (None, Producto.LIMON_AMARILLO):
        rows = (
            db.query(InventarioDesverdizado)
            .order_by(
                InventarioDesverdizado.fecha_recepcion.asc(),
                InventarioDesverdizado.id.asc(),
            )
            .all()
        )
        # Excluir melón en el fallback limón
        rows = [
            r
            for r in rows
            if str(getattr(r.producto, "value", r.producto) or "").lower() != "melon"
        ]
    exact = [r for r in rows if _norm_lote(r.lote) == lote_n]
    if exact:
        return exact
    ln = lote_n.casefold()
    return [r for r in rows if _norm_lote(r.lote).casefold() == ln]


def _parse_fecha_opt(val) -> "date | None":
    from datetime import date, datetime

    if val is None or val == "":
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    s = str(val).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _consumir_bins_lote(
    db: Session,
    lote: str,
    bins: int,
    fecha_recepcion=None,
    producto: Producto | None = None,
) -> list[dict]:
    """
    Descuenta bins de un lote en desverdizado / stock campo melón.
    Match flexible de lote (strip / case).

    - Con fecha_recepcion: solo de filas de esa fecha de corte.
    - Sin fecha: FIFO por fecha de corte (más antigua primero).

    Devuelve desglose [{lote, bins, fecha_recepcion}, ...] para anular
    devolviendo a la fecha exacta (evita mezclar 03-ago con 05-ago del mismo lote).
    """
    lote_n = _norm_lote(lote)
    bins = int(bins or 0)
    if bins <= 0 or not lote_n:
        raise HTTPException(status_code=400, detail="lote y bins > 0 son requeridos")

    fecha_obj = _parse_fecha_opt(fecha_recepcion)
    candidatos = _match_desverdizado_por_lote(db, lote_n, producto=producto)
    desvs = [d for d in candidatos if int(d.cantidad_bins or 0) > 0]
    if fecha_obj is not None:
        desvs = [
            d
            for d in desvs
            if d.fecha_recepcion and d.fecha_recepcion == fecha_obj
        ]
    # FIFO: ya vienen ordenados por fecha_recepcion ASC en _match
    restante = bins
    disp = sum(int(d.cantidad_bins or 0) for d in desvs)
    origen = "campo (melón)" if producto == Producto.MELON else "desverdizado"
    if disp < bins:
        extra = (
            f" en fecha de corte {fecha_obj}" if fecha_obj is not None else ""
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"No hay suficientes bins en {origen} para lote '{lote_n}'{extra}. "
                f"Disponible: {disp}, solicitado: {bins}"
            ),
        )
    desglose: list[dict] = []
    for d in desvs:
        if restante <= 0:
            break
        hay = int(d.cantidad_bins or 0)
        if hay <= 0:
            continue
        usar = min(restante, hay)
        d.cantidad_bins = hay - usar
        restante -= usar
        if d.cantidad_bins == 0:
            d.estado = "empaquetado"
        elif (d.estado or "") == "en_desverdizado":
            d.estado = "listo_empaque"
        fr = d.fecha_recepcion
        row = {
            "lote": lote_n,
            "bins": usar,
            "fecha_recepcion": str(fr) if fr else None,
        }
        desglose.append(row)
    if restante > 0:
        raise HTTPException(
            status_code=400,
            detail=f"No hay suficientes bins en desverdizado para lote '{lote_n}'. Faltan {restante}",
        )
    db.flush()
    return desglose


def _agregar_consumos_desverdizado(
    db: Session,
    consumos: list | None,
    producto: Producto | None = None,
    *,
    requerido: bool = True,
) -> list[dict]:
    """
    Normaliza y aplica consumos de desverdizado / bins melón (crea empaque / editar).

    Agrupa por (lote, fecha_recepcion):
    - Si la UI manda fecha de corte, se descuenta solo de esa fecha.
    - Si no manda fecha, FIFO global del lote y se DESGLOSA el resultado
      por fecha para poder anular sin mezclar cortes.
    """
    from collections import defaultdict

    # clave: (lote, fecha_str|None) → bins
    acc: dict[tuple[str, str | None], int] = defaultdict(int)
    for c in consumos or []:
        if not isinstance(c, dict):
            continue
        lo = _norm_lote(c.get("lote"))
        try:
            bi = int(c.get("bins") or 0)
        except (TypeError, ValueError):
            bi = 0
        if not lo or bi <= 0:
            continue
        fr = c.get("fecha_recepcion")
        fr_s = str(fr).strip()[:10] if fr else None
        if fr_s == "":
            fr_s = None
        acc[(lo, fr_s)] += bi
    if not acc:
        if not requerido:
            return []
        msg = (
            "Indica al menos un consumo de bins de melón (sección/lote + bins > 0)"
            if producto == Producto.MELON
            else "Indica al menos un consumo de desverdizado (lote + bins > 0)"
        )
        raise HTTPException(status_code=400, detail=msg)
    normalizados: list[dict] = []
    for (lo, fr_s), bi in acc.items():
        partes = _consumir_bins_lote(db, lo, bi, fr_s, producto=producto)
        if partes:
            normalizados.extend(partes)
        else:
            normalizados.append(
                {"lote": lo, "bins": bi, "fecha_recepcion": fr_s}
            )
    return normalizados


def _resumen_consumos(consumos: list[dict] | None) -> str:
    """Texto legible: 'lote@fecha:bins, ...' (fecha opcional)."""
    parts = []
    for c in consumos or []:
        lo = _norm_lote(c.get("lote") if isinstance(c, dict) else None)
        if not lo:
            continue
        try:
            bi = int(c.get("bins") or 0)
        except (TypeError, ValueError):
            bi = 0
        if bi <= 0:
            continue
        fr = c.get("fecha_recepcion") if isinstance(c, dict) else None
        if fr:
            parts.append(f"{lo}@{str(fr)[:10]}:{bi}")
        else:
            parts.append(f"{lo}:{bi}")
    return ", ".join(parts)


def _inferir_fechas_consumos_legacy(db: Session, consumos: list[dict]) -> list[dict]:
    """
    Empaques antiguos solo guardaron {lote, bins} sin fecha_recepcion.
    Al anular, reparte cada línea por reverse-FIFO de cupo de recepción
    (lo más nuevo con cupo libre primero = inverso del consumo FIFO).
    Así 65 bins de 8502 vuelven al 05-ago y no se mezclan con el 03-ago.
    """
    from app.models.inventory import RecepcionCampo

    out: list[dict] = []
    for c in consumos or []:
        if not isinstance(c, dict):
            continue
        lo = _norm_lote(c.get("lote"))
        try:
            bi = int(c.get("bins") or 0)
        except (TypeError, ValueError):
            bi = 0
        if not lo or bi <= 0:
            continue
        fr_exist = c.get("fecha_recepcion")
        if fr_exist:
            out.append(
                {
                    "lote": lo,
                    "bins": bi,
                    "fecha_recepcion": str(fr_exist).strip()[:10],
                }
            )
            continue

        # Stock actual por fecha
        candidatos = _match_desverdizado_por_lote(db, lo)
        stock_por_fecha: dict = {}
        for r in candidatos:
            if (r.estado or "").lower() == "eliminado":
                continue
            if not r.fecha_recepcion:
                continue
            stock_por_fecha[r.fecha_recepcion] = stock_por_fecha.get(
                r.fecha_recepcion, 0
            ) + int(r.cantidad_bins or 0)

        # Recibido por fecha
        recv_por_fecha: dict = {}
        recs = (
            db.query(RecepcionCampo)
            .filter(RecepcionCampo.producto == Producto.LIMON_AMARILLO)
            .order_by(RecepcionCampo.id.desc())
            .all()
        )
        for rec in recs:
            if _norm_lote(rec.lote).casefold() != lo.casefold():
                continue
            fr = getattr(rec, "fecha_corte", None) or getattr(rec, "fecha", None)
            if not fr:
                continue
            recv_por_fecha[fr] = recv_por_fecha.get(fr, 0) + int(
                rec.cantidad_bins or 0
            )

        restante = bi
        # reverse-FIFO: fechas más nuevas primero
        for fr in sorted(
            set(list(recv_por_fecha.keys()) + list(stock_por_fecha.keys())),
            reverse=True,
        ):
            if restante <= 0:
                break
            recibido = int(recv_por_fecha.get(fr, 0))
            actual = int(stock_por_fecha.get(fr, 0))
            cupo = max(0, recibido - actual) if recibido > 0 else 0
            if cupo <= 0:
                continue
            tomar = min(restante, cupo)
            out.append(
                {
                    "lote": lo,
                    "bins": tomar,
                    "fecha_recepcion": str(fr),
                }
            )
            stock_por_fecha[fr] = actual + tomar
            restante -= tomar

        if restante > 0:
            # Sin cupo inferible: devolver sin fecha (fallback reverse-FIFO en _devolver)
            out.append({"lote": lo, "bins": restante})
    return out


def _devolver_bins_lote(
    db: Session,
    lote: str,
    bins: int,
    fecha_recepcion=None,
    producto: Producto | None = None,
) -> None:
    """
    Devuelve bins a desverdizado / stock melón al anular/editar empaque.

    Si se conoce fecha_recepcion (corte), devuelve a esa fila o crea una con esa fecha
    (evita mezclar p.ej. corte 03-ago con 05-ago del mismo lote).

    Sin fecha: reverse-FIFO por recepción:
      el consumo FIFO saca primero lo más viejo, así que al devolver se rellena
      primero la capacidad libre de las recepciones más nuevas (p.ej. 05-ago antes
      que 03-ago). Nunca mezcla todo en una sola fecha si hay cupo en otra.
    """
    from datetime import date, timedelta
    from app.core.constants import DIAS_DESVERDIZADO
    from app.models.inventory import RecepcionCampo

    bins = int(bins or 0)
    lote_n = _norm_lote(lote)
    if bins <= 0 or not lote_n:
        return

    fecha_obj = _parse_fecha_opt(fecha_recepcion)

    prod = producto
    if prod is None:
        cand_l = _match_desverdizado_por_lote(db, lote_n, producto=Producto.LIMON_AMARILLO)
        cand_m = _match_desverdizado_por_lote(db, lote_n, producto=Producto.MELON)
        if cand_m and not cand_l:
            prod = Producto.MELON
            candidatos = cand_m
        else:
            prod = Producto.LIMON_AMARILLO
            candidatos = cand_l or cand_m
    else:
        candidatos = _match_desverdizado_por_lote(db, lote_n, producto=prod)

    def _add_to_row(des, n: int) -> None:
        des.lote = _norm_lote(des.lote) or lote_n
        des.cantidad_bins = int(des.cantidad_bins or 0) + int(n)
        if (des.estado or "").lower() in ("empaquetado", "eliminado", ""):
            des.estado = "listo_empaque"
        elif (des.estado or "").lower() not in ("en_desverdizado", "listo_empaque"):
            des.estado = "listo_empaque"

    def _crear_fila(fecha_rec: date, n: int, recepcion_id=None) -> None:
        tent = (
            fecha_rec
            if prod == Producto.MELON
            else fecha_rec + timedelta(days=DIAS_DESVERDIZADO)
        )
        nuevo = InventarioDesverdizado(
            producto=prod,
            cantidad_bins=int(n),
            lote=lote_n,
            fecha_recepcion=fecha_rec,
            fecha_tentativa_salida=tent,
            estado="listo_empaque",
            recepcion_id=recepcion_id,
        )
        db.add(nuevo)

    def _recs_lote() -> list:
        return [
            r
            for r in (
                db.query(RecepcionCampo)
                .filter(RecepcionCampo.producto == prod)
                .order_by(RecepcionCampo.id.desc())
                .all()
            )
            if _norm_lote(r.lote).casefold() == lote_n.casefold()
        ]

    # 1) Match exacto por fecha de corte si la conocemos
    if fecha_obj is not None:
        same_fecha = [
            r
            for r in candidatos
            if r.fecha_recepcion
            and r.fecha_recepcion == fecha_obj
            and (r.estado or "").lower() != "eliminado"
        ]
        if same_fecha:
            same_fecha.sort(
                key=lambda r: (
                    0
                    if (r.estado or "").lower() == "empaquetado"
                    or int(r.cantidad_bins or 0) == 0
                    else 1,
                    -(r.id or 0),
                )
            )
            _add_to_row(same_fecha[0], bins)
            db.flush()
            return

        recs = _recs_lote()
        rec = next(
            (
                r
                for r in recs
                if getattr(r, "fecha_corte", None) == fecha_obj
                or getattr(r, "fecha", None) == fecha_obj
            ),
            None,
        )
        _crear_fila(fecha_obj, bins, rec.id if rec else None)
        db.flush()
        return

    # 2) Sin fecha: reverse-FIFO por cupo de recepción (más nueva primero)
    # stock actual por fecha de corte
    stock_por_fecha: dict = {}
    rows_por_fecha: dict = {}
    for r in candidatos:
        if (r.estado or "").lower() == "eliminado":
            continue
        fr = r.fecha_recepcion
        if not fr:
            continue
        stock_por_fecha[fr] = stock_por_fecha.get(fr, 0) + int(r.cantidad_bins or 0)
        rows_por_fecha.setdefault(fr, []).append(r)

    # Recepciones del lote: fecha → (cantidad recibida, recepcion_id)
    recv_por_fecha: dict = {}
    for rec in _recs_lote():
        fr = getattr(rec, "fecha_corte", None) or getattr(rec, "fecha", None)
        if not fr:
            continue
        prev = recv_por_fecha.get(fr)
        if prev:
            recv_por_fecha[fr] = (prev[0] + int(rec.cantidad_bins or 0), prev[1])
        else:
            recv_por_fecha[fr] = (int(rec.cantidad_bins or 0), rec.id)

    restante = bins
    # Cupo libre = recibido − stock actual (lo que se “puede” reponer en esa fecha)
    fechas_orden = sorted(set(list(recv_por_fecha.keys()) + list(stock_por_fecha.keys())), reverse=True)
    for fr in fechas_orden:
        if restante <= 0:
            break
        recibido, rec_id = recv_por_fecha.get(fr, (0, None))
        actual = int(stock_por_fecha.get(fr, 0))
        # Si no hay recepción registrada, no inventar cupo; se maneja al final
        if recibido <= 0 and fr not in stock_por_fecha:
            continue
        cupo = max(0, recibido - actual) if recibido > 0 else 0
        # Filas vacías/empaquetadas de esa fecha también absorben sin límite de cupo
        # (por si recepción no está o cantidades desfasadas)
        vacias = [
            r
            for r in rows_por_fecha.get(fr, [])
            if int(r.cantidad_bins or 0) == 0
            or (r.estado or "").lower() == "empaquetado"
        ]
        if cupo <= 0 and not vacias:
            continue
        tomar = restante if vacias and cupo <= 0 else min(restante, cupo if cupo > 0 else restante)
        if tomar <= 0:
            continue
        if vacias:
            vacias.sort(key=lambda r: -(r.id or 0))
            _add_to_row(vacias[0], tomar)
        elif fr in rows_por_fecha and rows_por_fecha[fr]:
            # Hay fila con stock parcial de esa fecha: sumar ahí (misma fecha OK)
            rows_por_fecha[fr].sort(key=lambda r: -(r.id or 0))
            _add_to_row(rows_por_fecha[fr][0], tomar)
        else:
            _crear_fila(fr, tomar, rec_id)
        stock_por_fecha[fr] = actual + tomar
        restante -= tomar

    if restante <= 0:
        db.flush()
        return

    # 3) Resto: preferir filas empaquetadas/vacías (fecha más nueva), si no crear
    #    con la recepción más reciente del lote
    vacias_glob = [
        r
        for r in candidatos
        if (r.estado or "").lower() != "eliminado"
        and (
            int(r.cantidad_bins or 0) == 0
            or (r.estado or "").lower() == "empaquetado"
        )
    ]
    if vacias_glob:
        vacias_glob.sort(
            key=lambda r: (r.fecha_recepcion or date.min, r.id or 0),
            reverse=True,
        )
        _add_to_row(vacias_glob[0], restante)
        db.flush()
        return

    # Último recurso: NO mezclar en fila de otra fecha con stock.
    # Crear con recepción más reciente del lote.
    recs = _recs_lote()
    rec_match = recs[0] if recs else None
    hoy = date.today()
    fecha_rec = (
        (getattr(rec_match, "fecha_corte", None) or getattr(rec_match, "fecha", None))
        if rec_match
        else hoy
    )
    # Si ya existe fila de esa fecha, sumar ahí
    same = [
        r
        for r in candidatos
        if r.fecha_recepcion == fecha_rec and (r.estado or "").lower() != "eliminado"
    ]
    if same:
        same.sort(key=lambda r: -(r.id or 0))
        _add_to_row(same[0], restante)
    else:
        _crear_fila(fecha_rec, restante, rec_match.id if rec_match else None)
    db.flush()


def _sku_label(pres, talla_val, lote_val, fecha_val) -> str:
    return (
        f"{pres}"
        + (f" talla {talla_val}" if talla_val else "")
        + (f" lote {lote_val}" if lote_val else "")
        + (f" fecha {fecha_val}" if fecha_val else "")
    )


def _rows_para_ajuste(
    db: Session,
    pres: str,
    talla_val,
    mercado,
    lote_val,
    fecha_val,
    *,
    al_restar: bool,
) -> list:
    """
    Todas las filas del SKU (puede haber duplicados históricos).
    La UI suma stock; al restar hay que descontar de TODAS las filas.
    """
    rows = list(
        _rows_inv_limon(
            db,
            pres,
            talla_val,
            mercado=mercado,
            lote=lote_val,
            fecha_empaque=fecha_val,
        )
    )
    # Compat granel legacy sin fecha (solo al restar)
    if (
        al_restar
        and not rows
        and pres == "rpc_granel"
        and fecha_val
        and lote_val
    ):
        legacy = _rows_inv_limon(
            db, pres, talla_val, mercado=mercado, lote=lote_val, fecha_empaque=None
        )
        rows = [
            r
            for r in legacy
            if not _norm_fecha_emp(_extra_dict(r).get("fecha_empaque"))
        ]
    # Preferir mismo mercado, luego id asc (FIFO)
    mval = str(getattr(mercado, "value", mercado)) if mercado is not None else None

    def _sort_key(r):
        rm = str(getattr(r.mercado, "value", r.mercado))
        same = 0 if (mval and rm == mval) else 1
        return (same, r.id or 0)

    rows.sort(key=_sort_key)
    return rows


def _consolidar_filas_inventario(db: Session, rows: list, mercado) -> object | None:
    """
    Fusiona filas duplicadas del mismo SKU en una sola (la preferida).
    Evita que la UI muestre 27 y el backend solo vea 12 en una fila.
    """
    if not rows:
        return None
    keep = rows[0]
    total = sum(int(r.cantidad_stock or 0) for r in rows)
    for r in rows[1:]:
        if r.id == keep.id:
            continue
        # Vaciar duplicados (no borrar: FKs/auditoría)
        if (r.cantidad_stock or 0) != 0:
            r.cantidad_stock = 0
            r.fecha_actualizacion = datetime.utcnow()
    keep.cantidad_stock = total
    keep.fecha_actualizacion = datetime.utcnow()
    # Si keep no es del mercado pedido y hay otra del mercado, ya preferimos sort
    return keep


def _restar_una_linea_final(
    db: Session,
    mercado,
    linea: dict,
    *,
    best_effort: bool = False,
) -> tuple[int, str | None]:
    """
    Resta una línea de producción del inventario final.
    Devuelve (cantidad_restada, problema|None).
    best_effort=True: resta lo disponible (puede ser parcial) y reporta faltante.
    best_effort=False: exige stock completo o lanza HTTP 400.
    """
    pres = (linea.get("presentacion") or "").strip()
    cant = int(linea.get("cantidad") or 0)
    talla_val = _talla_for_pres(pres, linea.get("talla"))
    lote_val = _norm_lote_extra(linea.get("lote"))
    fecha_val = _norm_fecha_emp(linea.get("fecha_empaque") or linea.get("fecha"))
    if not pres or cant <= 0:
        return 0, None

    label = _sku_label(pres, talla_val, lote_val, fecha_val)
    calidad_ln = str(linea.get("calidad") or "").strip() or None
    rows = _rows_para_ajuste(
        db,
        pres,
        talla_val,
        mercado,
        lote_val,
        fecha_val,
        al_restar=True,
    )
    if calidad_ln:
        rows = [
            r
            for r in rows
            if str(_extra_dict(r).get("calidad") or "").strip().lower()
            == calidad_ln.lower()
        ]
    if len(rows) > 1:
        keep = _consolidar_filas_inventario(db, rows, mercado)
        rows = [keep] if keep is not None else rows
    # Releer filas por si consolidó
    if not rows:
        rows = _rows_para_ajuste(
            db, pres, talla_val, mercado, lote_val, fecha_val, al_restar=True
        )
        if calidad_ln:
            rows = [
                r
                for r in rows
                if str(_extra_dict(r).get("calidad") or "").strip().lower()
                == calidad_ln.lower()
            ]
    total = sum(int(r.cantidad_stock or 0) for r in rows if r is not None)
    if total <= 0:
        msg = f"Stock insuficiente de {label} (hay 0, se intentan restar {cant})"
        if best_effort:
            return 0, msg
        raise HTTPException(status_code=400, detail=msg)
    if total < cant and not best_effort:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Stock insuficiente de {label} "
                f"(hay {total}, se intentan restar {cant})"
            ),
        )

    a_restar = min(cant, total)
    restante = a_restar
    for inv in rows:
        if inv is None or restante <= 0:
            continue
        disp = int(inv.cantidad_stock or 0)
        if disp <= 0:
            continue
        toma = min(disp, restante)
        inv.cantidad_stock = disp - toma
        inv.fecha_actualizacion = datetime.utcnow()
        restante -= toma

    problema = None
    if a_restar < cant:
        problema = (
            f"Stock parcial de {label}: se revirtieron {a_restar} de {cant} "
            f"(faltan {cant - a_restar}; probablemente ya se convirtieron/embarcaron)"
        )
    return a_restar, problema


def _ajustar_inventario_final(
    db: Session,
    producto: Producto,
    mercado,
    produccion: list,
    signo: int,
    *,
    best_effort: bool = False,
) -> tuple[list[dict], list[str]]:
    """
    Suma (signo=+1) o resta (signo=-1) producción en inventario final.

    Resta: descuenta en FIFO sobre TODAS las filas del mismo SKU (talla/lote/fecha).
    Suma: consolida duplicados y suma en una sola fila.

    best_effort (solo resta): no aborta si una línea no tiene stock completo;
    revierte lo posible en cada línea y devuelve (revertidas, problemas).
    Así anular no deja granel/cartón huérfanos cuando otra línea falló primero.

    Devuelve (lineas_aplicadas, problemas).
    """
    aplicadas: list[dict] = []
    problemas: list[str] = []

    for linea in produccion or []:
        pres = (linea.get("presentacion") or "").strip()
        cant = int(linea.get("cantidad") or 0)
        talla_val = _talla_for_pres(pres, linea.get("talla"))
        lote_val = _norm_lote_extra(linea.get("lote"))
        fecha_val = _norm_fecha_emp(linea.get("fecha_empaque") or linea.get("fecha"))
        if not pres or cant <= 0:
            continue
        if pres == "rpc_granel" and not lote_val and signo > 0:
            raise HTTPException(
                status_code=400,
                detail="RPC a granel requiere lote de origen en cada línea de producción",
            )
        if pres == "rpc_granel" and not fecha_val and signo > 0:
            raise HTTPException(
                status_code=400,
                detail="RPC a granel requiere fecha de empaque (día de la corrida)",
            )

        calidad_ln = str(linea.get("calidad") or "").strip() or None

        if signo < 0:
            # Melón: no mezclar LLANO vs Wallys al restar
            if calidad_ln:
                linea = {**linea, "calidad": calidad_ln}
            restado, problema = _restar_una_linea_final(
                db, mercado, linea, best_effort=best_effort
            )
            if restado > 0:
                aplicadas.append(
                    {
                        "presentacion": pres,
                        "talla": talla_val,
                        "lote": lote_val,
                        "fecha_empaque": fecha_val,
                        "calidad": calidad_ln,
                        "cantidad": restado,
                        "solicitado": cant,
                    }
                )
            if problema:
                problemas.append(problema)
            continue

        # signo > 0: sumar
        label = _sku_label(pres, talla_val, lote_val, fecha_val)
        rows = _rows_para_ajuste(
            db,
            pres,
            talla_val,
            mercado,
            lote_val,
            fecha_val,
            al_restar=False,
        )
        if calidad_ln:
            rows = [
                r
                for r in rows
                if str(_extra_dict(r).get("calidad") or "").strip().lower()
                == calidad_ln.lower()
            ]
        # Filtrar mismo producto (melón vs limón) si aplica
        if producto:
            pval = str(getattr(producto, "value", producto))
            rows = [
                r
                for r in rows
                if str(getattr(r.producto, "value", r.producto)) == pval
            ]
        if rows:
            if len(rows) > 1:
                keep = _consolidar_filas_inventario(db, rows, mercado)
            else:
                keep = rows[0]
            if keep is not None:
                keep.cantidad_stock = int(keep.cantidad_stock or 0) + cant
                keep.fecha_actualizacion = datetime.utcnow()
                aplicadas.append(
                    {
                        "presentacion": pres,
                        "talla": talla_val,
                        "lote": lote_val,
                        "fecha_empaque": fecha_val,
                        "calidad": calidad_ln,
                        "cantidad": cant,
                    }
                )
                continue

        calidad = calidad_ln or _calidad_pres(pres)
        extra = {"presentacion": pres, "calidad": calidad}
        if talla_val:
            extra["talla"] = talla_val
        if lote_val:
            extra["lote"] = lote_val
        if fecha_val and pres == "rpc_granel":
            extra["fecha_empaque"] = fecha_val
        elif fecha_val and lote_val:
            extra["fecha_empaque"] = fecha_val
        elif fecha_val and producto == Producto.MELON:
            extra["fecha_empaque"] = fecha_val
        db.add(
            InventarioFinal(
                producto=producto if producto else Producto.LIMON_AMARILLO,
                variedad=None,
                tipo_cultivo=None,
                mercado=mercado,
                cantidad_stock=cant,
                atributos_extra=extra,
                fecha_actualizacion=datetime.utcnow(),
            )
        )
        aplicadas.append(
            {
                "presentacion": pres,
                "talla": talla_val,
                "lote": lote_val,
                "fecha_empaque": fecha_val,
                "cantidad": cant,
            }
        )

    return aplicadas, problemas


def _validar_restar_produccion(db: Session, mercado, produccion: list) -> list[str]:
    """
    Dry-run: verifica si se puede restar la producción del inventario final.
    No muta la BD. Devuelve lista de problemas (vacía = OK).
    Usa la SUMA de todas las filas del SKU (como la UI de granel).
    """
    problemas: list[str] = []
    for linea in produccion or []:
        pres = (linea.get("presentacion") or "").strip()
        cant = int(linea.get("cantidad") or 0)
        talla_val = _talla_for_pres(pres, linea.get("talla"))
        lote_val = _norm_lote_extra(linea.get("lote"))
        fecha_val = _norm_fecha_emp(linea.get("fecha_empaque") or linea.get("fecha"))
        if not pres or cant <= 0:
            continue
        hay = _stock_limon(
            db,
            pres,
            talla_val,
            mercado=None,  # suma todas las filas del SKU (como la UI)
            lote=lote_val,
            fecha_empaque=fecha_val,
        )
        if hay <= 0:
            problemas.append(
                f"No existe inventario final de {pres}"
                + (f" talla {talla_val}" if talla_val else "")
                + (f" lote {lote_val}" if lote_val else "")
                + (f" fecha {fecha_val}" if fecha_val else "")
            )
            continue
        if hay < cant:
            problemas.append(
                f"Stock insuficiente de {pres}"
                + (f" talla {talla_val}" if talla_val else "")
                + (f" lote {lote_val}" if lote_val else "")
                + (f" fecha {fecha_val}" if fecha_val else "")
                + f" (hay {hay}, se necesitan {cant}). "
                f"Probablemente ya se embarcó parte o todo."
            )
    return problemas


def _netear_produccion(old_prod: list, new_prod: list) -> list[dict]:
    """
    Deltas netos por (presentacion, talla, lote, fecha_empaque, calidad).
    Incluye calidad para no mezclar LLANO vs Wallys en melón.
    """
    from collections import defaultdict

    acc: dict[
        tuple[str, str | None, str | None, str | None, str | None], int
    ] = defaultdict(int)

    def _cal(p: dict) -> str | None:
        c = str(p.get("calidad") or "").strip().lower() or None
        return c

    for p in old_prod or []:
        if not isinstance(p, dict):
            continue
        pres = (p.get("presentacion") or "").strip()
        if not pres:
            continue
        talla = _talla_for_pres(pres, p.get("talla"))
        lote = _norm_lote_extra(p.get("lote"))
        fecha = _norm_fecha_emp(p.get("fecha_empaque") or p.get("fecha"))
        acc[(pres, talla, lote, fecha, _cal(p))] -= int(p.get("cantidad") or 0)
    for p in new_prod or []:
        if not isinstance(p, dict):
            continue
        pres = (p.get("presentacion") or "").strip()
        if not pres:
            continue
        talla = _talla_for_pres(pres, p.get("talla"))
        lote = _norm_lote_extra(p.get("lote"))
        fecha = _norm_fecha_emp(p.get("fecha_empaque") or p.get("fecha"))
        acc[(pres, talla, lote, fecha, _cal(p))] += int(p.get("cantidad") or 0)

    out: list[dict] = []
    for (pres, talla, lote, fecha, cal), delta in acc.items():
        if delta == 0:
            continue
        row = {
            "presentacion": pres,
            "talla": talla,
            "lote": lote,
            "fecha_empaque": fecha,
            "cantidad": abs(delta),
            "_signo": 1 if delta > 0 else -1,
        }
        if cal:
            row["calidad"] = cal
        out.append(row)
    return out


def _etiquetar_produccion_con_lote(
    lineas: list,
    consumos: list,
    fecha_empaque: str | None = None,
) -> list[dict]:
    """
    Asegura que rpc_granel lleve lote de origen y fecha_empaque (día de corrida).
    Cada día de empaque genera filas de inventario separadas.
    """
    lotes_cons = sorted(
        {
            _norm_lote(c.get("lote"))
            for c in (consumos or [])
            if isinstance(c, dict) and _norm_lote(c.get("lote"))
        }
    )
    fecha_n = _norm_fecha_emp(fecha_empaque)
    out: list[dict] = []
    for p in lineas or []:
        if not isinstance(p, dict):
            continue
        linea = dict(p)
        pres = (linea.get("presentacion") or "").strip()
        lote_ln = _norm_lote_extra(linea.get("lote"))
        if pres == "rpc_granel":
            if not lote_ln:
                if len(lotes_cons) == 1:
                    lote_ln = lotes_cons[0]
                elif len(lotes_cons) == 0:
                    raise HTTPException(
                        status_code=400,
                        detail="RPC a granel requiere consumo de lote de desverdizado",
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Hay varios lotes en el empaque: indica el lote de origen "
                            "en cada línea de RPC a granel"
                        ),
                    )
            if lote_ln not in lotes_cons and lotes_cons:
                ok = any(l.casefold() == lote_ln.casefold() for l in lotes_cons)
                if not ok:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Lote '{lote_ln}' no está en los consumos de desverdizado",
                    )
            linea["lote"] = lote_ln
            if not _norm_fecha_emp(linea.get("fecha_empaque")):
                if not fecha_n:
                    raise HTTPException(
                        status_code=400,
                        detail="RPC a granel requiere fecha de empaque de la corrida",
                    )
                linea["fecha_empaque"] = fecha_n
            else:
                linea["fecha_empaque"] = _norm_fecha_emp(linea.get("fecha_empaque"))
        else:
            if not lote_ln and len(lotes_cons) == 1:
                linea["lote"] = lotes_cons[0]
            if fecha_n and not _norm_fecha_emp(linea.get("fecha_empaque")):
                linea["fecha_empaque"] = fecha_n
        out.append(linea)
    return out

@router.post("/", response_model=EmpaqueResponse)
def crear_empaque(
    empaque: EmpaqueCreate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN, Rol.RECEPCION_EMPACADOR, Rol.EMPACADOR]))
):
    fecha_emp = _parse_fecha_empaque(empaque.fecha)
    if not fecha_emp:
        raise HTTPException(
            status_code=400,
            detail="La fecha de empaque es obligatoria (formato YYYY-MM-DD)",
        )

    if empaque.producto == Producto.UVA:
        # 1. Verificar inventario de campo por variedad + mercado
        inv_campo = db.query(InventarioCampo).filter(
            InventarioCampo.variedad == empaque.variedad,
            InventarioCampo.mercado == empaque.mercado,
        ).first()
        
        if not inv_campo or inv_campo.cantidad_disponible < empaque.cantidad_cajas_campo_usadas:
            raise HTTPException(
                status_code=400, 
                detail=f"No hay suficiente inventario de cajas de campo de {empaque.variedad} ({empaque.mercado}). Disponible: {inv_campo.cantidad_disponible if inv_campo else 0}"
            )
        
        # 2. Restar del inventario de campo correcto (por mercado)
        inv_campo.cantidad_disponible -= empaque.cantidad_cajas_campo_usadas
    
    consumos_aplicados: list[dict] = []
    if empaque.producto == Producto.LIMON_AMARILLO:
        # Consumir de inventario de desverdizado (soporta múltiples lotes)
        consumos_raw = empaque.consumos_desverdizado or []
        if empaque.bins_desverdizado_usados > 0 and not consumos_raw:
            consumos_raw = [
                {
                    "lote": empaque.lote_desverdizado,
                    "bins": empaque.bins_desverdizado_usados,
                }
            ]
        consumos_aplicados = _agregar_consumos_desverdizado(db, consumos_raw)

        # Producir a inventario final (granel lleva lote de origen)
        lineas = empaque.produccion or []
        if not lineas:
            talla = getattr(empaque, "talla", None)
            lineas = []
            for pres, cant in [
                ("rpc_12", empaque.cantidad_rpc12),
                ("rpc_18", empaque.cantidad_rpc18),
                ("caja_40lbs", empaque.cantidad_caja40lbs),
                ("bins_jugo", empaque.cantidad_bins_jugo),
            ]:
                if cant and cant > 0:
                    lineas.append({
                        "presentacion": pres,
                        "talla": None if pres == "bins_jugo" else talla,
                        "cantidad": cant,
                    })
        lineas = _etiquetar_produccion_con_lote(
            lineas, consumos_aplicados, fecha_empaque=str(fecha_emp)
        )
        _ajustar_inventario_final(
            db, empaque.producto, empaque.mercado, lineas, signo=+1
        )

    if empaque.producto == Producto.MELON:
        # Melón: bins de campo por sección (obligatorio) + producción LLANO/Wallys
        # A diferencia del limón: un solo lote por empaque (sin mezclar secciones).
        consumos_raw = empaque.consumos_desverdizado or []
        if empaque.bins_desverdizado_usados > 0 and not consumos_raw:
            consumos_raw = [
                {
                    "lote": empaque.lote_desverdizado,
                    "bins": empaque.bins_desverdizado_usados,
                }
            ]
        lotes_m = {
            _norm_lote(c.get("lote"))
            for c in (consumos_raw or [])
            if isinstance(c, dict) and _norm_lote(c.get("lote"))
        }
        if len(lotes_m) > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    "En melón no se mezclan lotes en un mismo empaque. "
                    "Registra cada lote por separado (usa «Registrar otro lote»)."
                ),
            )
        consumos_aplicados = _agregar_consumos_desverdizado(
            db, consumos_raw, producto=Producto.MELON, requerido=True
        )

        lineas_melon = list(empaque.produccion or [])
        if not lineas_melon:
            raise HTTPException(
                status_code=400,
                detail="Indica al menos una línea de producción de melón",
            )
        for ln in lineas_melon:
            if not ln.get("fecha_empaque"):
                ln["fecha_empaque"] = str(fecha_emp)
        lineas_melon = _etiquetar_produccion_con_lote(
            lineas_melon, consumos_aplicados, fecha_empaque=str(fecha_emp)
        )
        _ajustar_inventario_final(
            db, empaque.producto, empaque.mercado, lineas_melon, signo=+1
        )

    # 3. Crear el registro de empaque (auditoría)
    detalle_corrida = None
    bins_usados = empaque.bins_desverdizado_usados or 0
    lineas_guardadas: list = []
    if empaque.producto == Producto.LIMON_AMARILLO:
        consumos = consumos_aplicados or empaque.consumos_desverdizado or []
        if empaque.bins_desverdizado_usados > 0 and not consumos:
            consumos = [{"lote": empaque.lote_desverdizado, "bins": empaque.bins_desverdizado_usados}]
        lineas_guardadas = empaque.produccion or []
        if not lineas_guardadas:
            talla = getattr(empaque, "talla", None)
            lineas_guardadas = []
            for pres, cant in [
                ("rpc_12", empaque.cantidad_rpc12),
                ("rpc_18", empaque.cantidad_rpc18),
                ("caja_40lbs", empaque.cantidad_caja40lbs),
                ("bins_jugo", empaque.cantidad_bins_jugo),
            ]:
                if cant and cant > 0:
                    lineas_guardadas.append({
                        "presentacion": pres,
                        "talla": None if pres == "bins_jugo" else talla,
                        "cantidad": cant,
                    })
        lineas_guardadas = _etiquetar_produccion_con_lote(
            lineas_guardadas, consumos, fecha_empaque=str(fecha_emp)
        )
        bins_usados = sum(int(c.get("bins") or 0) for c in consumos)
        lotes = _resumen_consumos(consumos) or empaque.lote_desverdizado
        detalle_corrida = {
            "consumos": consumos,
            "produccion": lineas_guardadas,
            "bins_campo": bins_usados,
            "lotes_resumen": lotes,
        }

    if empaque.producto == Producto.MELON:
        consumos = consumos_aplicados or empaque.consumos_desverdizado or []
        lineas_guardadas = list(empaque.produccion or [])
        for ln in lineas_guardadas:
            if not ln.get("fecha_empaque"):
                ln["fecha_empaque"] = str(fecha_emp)
        lineas_guardadas = _etiquetar_produccion_con_lote(
            lineas_guardadas, consumos, fecha_empaque=str(fecha_emp)
        )
        bins_usados = sum(int(c.get("bins") or 0) for c in consumos)
        lotes = _resumen_consumos(consumos) or empaque.lote_desverdizado
        detalle_corrida = {
            "consumos": consumos,
            "produccion": lineas_guardadas,
            "bins_campo": bins_usados,
            "lotes_resumen": lotes,
            "origen": "campo",
        }

    nuevo_empaque = Empaque(
        producto=empaque.producto,
        fecha=fecha_emp,
        variedad=empaque.variedad,
        tipo_cultivo=empaque.tipo_cultivo,
        mercado=empaque.mercado,
        cantidad_cajas_campo_usadas=empaque.cantidad_cajas_campo_usadas,
        cantidad_cajas_carton_producidas=empaque.cantidad_cajas_carton_producidas,
        porcentaje_merma=empaque.porcentaje_merma,
        notas_merma=empaque.notas_merma,
        numero_empacador=empaque.numero_empacador,
        bins_desverdizado_usados=bins_usados,
        lote_desverdizado=empaque.lote_desverdizado,
        presentacion=empaque.presentacion,
        talla=empaque.talla,
        calidad=empaque.calidad,
        cantidad_producida=empaque.cantidad_producida,
        detalle_corrida=detalle_corrida,
        usuario_id=current_user.id if hasattr(current_user, 'id') else None
    )
    if empaque.producto == Producto.LIMON_AMARILLO and detalle_corrida:
        _sync_legacy_empaque_fields(
            nuevo_empaque,
            produccion=detalle_corrida.get("produccion"),
            consumos=detalle_corrida.get("consumos"),
            bins_usados=bins_usados,
        )
    db.add(nuevo_empaque)
    
    # 4. Actualizar inventario final para uva
    if empaque.producto == Producto.UVA:
        inv_final = db.query(InventarioFinal).filter(
            InventarioFinal.producto == empaque.producto,
            InventarioFinal.variedad == empaque.variedad,
            InventarioFinal.tipo_cultivo == empaque.tipo_cultivo,
            InventarioFinal.mercado == empaque.mercado,
        ).first()
        
        if inv_final:
            inv_final.cantidad_stock += empaque.cantidad_cajas_carton_producidas
        else:
            inv_final = InventarioFinal(
                producto=empaque.producto,
                variedad=empaque.variedad,
                tipo_cultivo=empaque.tipo_cultivo,
                mercado=empaque.mercado,
                cantidad_stock=empaque.cantidad_cajas_carton_producidas
            )
            db.add(inv_final)
    
    db.commit()
    db.refresh(nuevo_empaque)
    return nuevo_empaque


@router.get("/", response_model=list[EmpaqueResponse])
def listar_empaques(db: Session = Depends(get_db)):
    return db.query(Empaque).order_by(Empaque.id.desc()).limit(100).all()


@router.get("/admin/recientes", response_model=list[EmpaqueResponse])
def listar_empaques_admin(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """Lista empaques recientes (solo admin) para correcciones."""
    return (
        db.query(Empaque)
        .order_by(Empaque.id.desc())
        .limit(50)
        .all()
    )


def _parse_fecha_empaque(s: str | None):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail=f"Fecha inválida: {s}")


def _norm_consumos(raw: list | None) -> list[dict]:
    out = []
    for c in raw or []:
        lote = str(c.get("lote") or "").strip()
        bins = int(c.get("bins") or 0)
        if not lote or bins <= 0:
            continue
        row: dict = {"lote": lote, "bins": bins}
        fr = c.get("fecha_recepcion")
        if fr:
            row["fecha_recepcion"] = str(fr).strip()[:10]
        out.append(row)
    return out


def _norm_produccion(raw: list | None) -> list[dict]:
    out = []
    for p in raw or []:
        if not isinstance(p, dict):
            continue
        pres = str(p.get("presentacion") or "").strip()
        cant = int(p.get("cantidad") or 0)
        if not pres or cant <= 0:
            continue
        talla = _talla_for_pres(pres, p.get("talla"))
        lote = _norm_lote_extra(p.get("lote"))
        fecha = _norm_fecha_emp(p.get("fecha_empaque") or p.get("fecha"))
        row = {"presentacion": pres, "talla": talla, "cantidad": cant}
        if lote:
            row["lote"] = lote
        if fecha:
            row["fecha_empaque"] = fecha
        # Melón: calidad LLANO/Wallys y meta de parrillas
        cal = str(p.get("calidad") or "").strip().lower() or None
        if cal:
            row["calidad"] = cal
        if p.get("cantidad_parrillas") is not None:
            try:
                row["cantidad_parrillas"] = float(p.get("cantidad_parrillas") or 0)
            except (TypeError, ValueError):
                pass
        if p.get("cajas_por_parrilla") is not None:
            try:
                row["cajas_por_parrilla"] = int(p.get("cajas_por_parrilla") or 0)
            except (TypeError, ValueError):
                pass
        out.append(row)
    return out


def _recuperar_lotes_granel_desde_old(
    old_prod: list[dict],
    new_prod: list[dict],
) -> list[dict]:
    """
    Si el cliente envía rpc_granel sin lote (UI que no reenvía lote), rellena
    desde la producción anterior emparejando presentacion+talla+cantidad.
    Cada match se usa una sola vez (multi-líneas igual talla/cant distintas).
    """
    pool: list[dict] = []
    for o in old_prod or []:
        if (o.get("presentacion") or "") != "rpc_granel":
            continue
        lote = _norm_lote_extra(o.get("lote"))
        if not lote:
            continue
        pool.append(
            {
                "talla": str(o.get("talla") or ""),
                "cantidad": int(o.get("cantidad") or 0),
                "lote": lote,
                "fecha_empaque": _norm_fecha_emp(o.get("fecha_empaque")),
            }
        )

    out: list[dict] = []
    for p in new_prod or []:
        linea = dict(p)
        if (linea.get("presentacion") or "") == "rpc_granel" and not _norm_lote_extra(
            linea.get("lote")
        ):
            talla = str(linea.get("talla") or "")
            cant = int(linea.get("cantidad") or 0)
            match_i = next(
                (
                    i
                    for i, cand in enumerate(pool)
                    if cand["talla"] == talla and cand["cantidad"] == cant
                ),
                None,
            )
            if match_i is None:
                # fallback: misma talla (cantidad pudo cambiar levemente)
                match_i = next(
                    (i for i, cand in enumerate(pool) if cand["talla"] == talla),
                    None,
                )
            if match_i is not None:
                cand = pool.pop(match_i)
                linea["lote"] = cand["lote"]
                if not _norm_fecha_emp(linea.get("fecha_empaque")) and cand.get(
                    "fecha_empaque"
                ):
                    linea["fecha_empaque"] = cand["fecha_empaque"]
        out.append(linea)
    return out


@router.put("/{empaque_id}/editar", response_model=EmpaqueResponse)
def editar_empaque_completo(
    empaque_id: int,
    body: EmpaqueEditRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Edición completa de empaque limón o melón (admin):
    - Reemplaza consumos (lotes/bins): devuelve los viejos y descuenta los nuevos.
    - Reemplaza producción: resta del inventario final lo anterior y suma lo nuevo.
    - Opcional: fecha, empacador, mercado.
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    if emp.producto not in (Producto.LIMON_AMARILLO, Producto.MELON):
        raise HTTPException(
            status_code=400,
            detail="Edición completa solo para limón o melón",
        )

    es_melon = emp.producto == Producto.MELON
    detalle = _detalle_as_dict(emp.detalle_corrida)
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="El empaque está anulado; no se puede editar")

    old_consumos = _norm_consumos(detalle.get("consumos"))
    if not old_consumos and emp.bins_desverdizado_usados:
        old_consumos = [{
            "lote": emp.lote_desverdizado or "SIN_LOTE",
            "bins": int(emp.bins_desverdizado_usados),
        }]
    # Empaques legacy sin fecha_recepcion → inferir por reverse-FIFO
    old_consumos = _inferir_fechas_consumos_legacy(db, old_consumos)
    old_produccion = _norm_produccion(detalle.get("produccion"))
    if not old_produccion and emp.presentacion and emp.cantidad_producida:
        old_row = {
            "presentacion": emp.presentacion,
            "talla": emp.talla,
            "cantidad": emp.cantidad_producida,
        }
        if emp.calidad:
            old_row["calidad"] = str(emp.calidad)
        old_produccion = [old_row]

    es_conversion = detalle.get("tipo") == "conversion_rpc_granel"

    # Consumos: si el cliente manda lista vacía o null, conservar los del proceso.
    # Agregar jugo/cartón no implica nuevos bins de campo: salen de los ya usados.
    if body.consumos is None:
        new_consumos = list(old_consumos)
    else:
        new_consumos = _norm_consumos(body.consumos)
        if not new_consumos and old_consumos:
            new_consumos = list(old_consumos)
    new_produccion = (
        _norm_produccion(body.produccion)
        if body.produccion is not None
        else old_produccion
    )

    if es_melon:
        lotes_m = {
            _norm_lote(c.get("lote"))
            for c in (new_consumos or [])
            if isinstance(c, dict) and _norm_lote(c.get("lote"))
        }
        if len(lotes_m) > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    "En melón no se mezclan lotes en un mismo empaque. "
                    "Deja un solo lote por registro."
                ),
            )

    # Asegurar lote + fecha_empaque en granel según consumos (limón)
    if body.produccion is not None:
        fecha_edit = None
        if body.fecha:
            fecha_edit = _parse_fecha_empaque(body.fecha)
        fecha_edit = fecha_edit or emp.fecha
        if not es_melon:
            # Recuperar lote de líneas granel previas si el cliente no envió lote
            new_produccion = _recuperar_lotes_granel_desde_old(
                old_produccion, new_produccion
            )
        # Etiquetar lote/fecha en líneas que lo necesiten
        cons_para_etiqueta = new_consumos or old_consumos
        if not cons_para_etiqueta:
            cons_para_etiqueta = [
                {"lote": _norm_lote_extra(p.get("lote")), "bins": 1}
                for p in old_produccion
                if _norm_lote_extra(p.get("lote"))
            ]
        new_produccion = _etiquetar_produccion_con_lote(
            new_produccion,
            cons_para_etiqueta,
            fecha_empaque=str(fecha_edit) if fecha_edit else None,
        )

    if not new_consumos and not es_conversion and body.produccion is not None:
        # Empaque desde desverdizado sin consumos conocidos: solo bloquear si tampoco
        # hay producción solo de ajustes imposibles. Conversión sí puede no tener consumos.
        if not old_consumos and emp.bins_desverdizado_usados:
            new_consumos = [{
                "lote": _norm_lote(emp.lote_desverdizado) or "SIN_LOTE",
                "bins": int(emp.bins_desverdizado_usados),
            }]
    if body.produccion is not None and not new_produccion:
        raise HTTPException(status_code=400, detail="Debe haber al menos una línea de producción")
    if es_melon and body.produccion is not None:
        for ln in new_produccion:
            if not str(ln.get("calidad") or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="Cada línea de melón debe indicar calidad (llano o wallys)",
                )

    def _clave_consumo(c: dict) -> tuple:
        return (
            _norm_lote(c.get("lote")).casefold(),
            int(c.get("bins") or 0),
            str(c.get("fecha_recepcion") or "")[:10],
        )

    consumos_cambiaron = sorted(_clave_consumo(c) for c in old_consumos) != sorted(
        _clave_consumo(c) for c in new_consumos
    )

    # 1–2) Solo mover bins/desverdizado si los lotes/bins de campo cambiaron.
    if consumos_cambiaron:
        for c in old_consumos:
            _devolver_bins_lote(
                db,
                c["lote"],
                c["bins"],
                c.get("fecha_recepcion"),
                producto=emp.producto,
            )
        if new_consumos:
            new_consumos = _agregar_consumos_desverdizado(
                db,
                new_consumos,
                producto=emp.producto,
                requerido=bool(es_melon),
            )
        else:
            new_consumos = []
    else:
        # Conservar desglose con fecha_recepcion del registro original
        new_consumos = list(old_consumos) if old_consumos else list(new_consumos)

    # 3) Ajuste NETO de producción (no restar todo y sumar: evita fallos de stock intermedio)
    mercado_dest = body.mercado if body.mercado is not None else emp.mercado
    for net in _netear_produccion(old_produccion, new_produccion):
        linea_net = {
            "presentacion": net["presentacion"],
            "talla": net["talla"],
            "lote": net.get("lote"),
            "fecha_empaque": net.get("fecha_empaque"),
            "cantidad": net["cantidad"],
        }
        if net.get("calidad"):
            linea_net["calidad"] = net["calidad"]
        _ajustar_inventario_final(
            db,
            emp.producto,
            mercado_dest,
            [linea_net],
            signo=int(net["_signo"]),
        )

    bins_total = sum(int(c.get("bins") or 0) for c in new_consumos) or int(
        detalle.get("bins_campo") or emp.bins_desverdizado_usados or 0
    )
    detalle = {
        **detalle,
        "consumos": new_consumos,
        "produccion": new_produccion,
        "bins_campo": bins_total,
        "lotes_resumen": _resumen_consumos(new_consumos) or detalle.get("lotes_resumen"),
        "editado_por": getattr(current_user, "username", None),
    }
    emp.detalle_corrida = detalle
    _sync_legacy_empaque_fields(
        emp,
        produccion=new_produccion,
        consumos=new_consumos,
        bins_usados=bins_total,
    )

    if body.numero_empacador is not None:
        emp.numero_empacador = body.numero_empacador.strip() or emp.numero_empacador
    if body.mercado is not None:
        emp.mercado = body.mercado
    if body.fecha is not None:
        f = _parse_fecha_empaque(body.fecha)
        if f:
            emp.fecha = f

    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()
    db.refresh(emp)
    return emp


@router.post("/{empaque_id}/agregar-consumo", response_model=EmpaqueResponse)
def agregar_consumo_lote(
    empaque_id: int,
    body: AgregarConsumoRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Corrige un empaque de limón al que le faltó descontar bins de un lote.
    Solo descuenta desverdizado y actualiza detalle_corrida (no cambia producción).
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    if emp.producto != Producto.LIMON_AMARILLO:
        raise HTTPException(status_code=400, detail="Solo aplica a empaques de limón")

    detalle = _detalle_as_dict(emp.detalle_corrida)
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="El empaque está anulado")

    fr_body = getattr(body, "fecha_recepcion", None)
    partes = _consumir_bins_lote(db, body.lote.strip(), body.bins, fr_body)

    consumos = list(detalle.get("consumos") or [])
    if partes:
        consumos.extend(partes)
    else:
        row = {"lote": body.lote.strip(), "bins": body.bins}
        if fr_body:
            row["fecha_recepcion"] = str(fr_body).strip()[:10]
        consumos.append(row)
    bins_total = sum(int(c.get("bins") or 0) for c in consumos)
    detalle = {
        **detalle,
        "consumos": consumos,
        "produccion": detalle.get("produccion") or [],
        "bins_campo": bins_total,
        "lotes_resumen": _resumen_consumos(consumos),
    }
    emp.detalle_corrida = detalle
    _sync_legacy_empaque_fields(
        emp,
        produccion=detalle.get("produccion"),
        consumos=consumos,
        bins_usados=bins_total,
    )
    # SQLAlchemy JSON mutability
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()
    db.refresh(emp)
    return emp


def _consumos_desde_empaque(emp: Empaque, detalle: dict) -> list[dict]:
    """
    Obtiene consumos de bins de campo a devolver.
    Prioridad: detalle.consumos → bins_campo/lotes_resumen → columnas del empaque.
    """
    consumos = _norm_consumos(detalle.get("consumos"))
    if consumos:
        return consumos

    # bins_campo en detalle
    bins_campo = int(detalle.get("bins_campo") or 0)
    lotes_resumen = (detalle.get("lotes_resumen") or "").strip()
    if bins_campo > 0 and lotes_resumen and ":" in lotes_resumen:
        # formato "lote1:10, lote2:5"
        parsed = []
        for part in lotes_resumen.split(","):
            part = part.strip()
            if ":" not in part:
                continue
            lo, bi = part.rsplit(":", 1)
            try:
                b = int(bi.strip())
            except ValueError:
                continue
            lo = lo.strip()
            if lo and b > 0:
                parsed.append({"lote": lo, "bins": b})
        if parsed:
            return parsed

    if emp.bins_desverdizado_usados and int(emp.bins_desverdizado_usados) > 0:
        return [
            {
                "lote": _norm_lote(emp.lote_desverdizado) or "SIN_LOTE",
                "bins": int(emp.bins_desverdizado_usados),
            }
        ]

    if bins_campo > 0:
        return [
            {
                "lote": _norm_lote(emp.lote_desverdizado) or "SIN_LOTE",
                "bins": bins_campo,
            }
        ]
    return []


@router.post("/{empaque_id}/anular", response_model=AnularEmpaqueResponse)
def anular_empaque(
    empaque_id: int,
    forzar: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Anula un empaque de limón: devuelve bins a desverdizado y resta producción del inventario final.

    Si el inventario final ya no alcanza (p. ej. se embarcó), por defecto **bloquea**
    la anulación para no devolver bins dejando el final inconsistente.
    Pasa `forzar=true` (query) para anular de todos modos: devuelve bins y deja
    `aviso_anulacion` en detalle_corrida (el admin asume el desfase de final).
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    if emp.producto not in (Producto.LIMON_AMARILLO, Producto.MELON):
        raise HTTPException(
            status_code=400,
            detail="Anular automático solo para limón o melón",
        )

    detalle = _detalle_as_dict(emp.detalle_corrida)
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="Este empaque ya está anulado")

    consumos = _consumos_desde_empaque(emp, detalle)
    # Crítico: empaques viejos sin fecha_recepcion → inferir por cupo de recepción
    # (reverse-FIFO) para no devolver bins del 05-ago al stock del 03-ago del mismo lote.
    consumos = _inferir_fechas_consumos_legacy(db, consumos)
    produccion = _norm_produccion(detalle.get("produccion"))
    if not produccion and emp.presentacion and emp.cantidad_producida:
        row = {
            "presentacion": emp.presentacion,
            "talla": emp.talla,
            "cantidad": emp.cantidad_producida,
        }
        if emp.calidad:
            row["calidad"] = str(emp.calidad)
        produccion = [row]

    # Pre-check inventario final ANTES de devolver bins (evita estado a medias)
    problemas_final: list[str] = []
    if produccion:
        problemas_final = _validar_restar_produccion(db, emp.mercado, produccion)

    if problemas_final and not forzar:
        detalle_msg = " | ".join(problemas_final)
        raise HTTPException(
            status_code=409,
            detail=(
                f"No se puede anular el empaque #{empaque_id} sin forzar: "
                f"{detalle_msg}. "
                f"Si confirmas, se devolverán bins a desverdizado pero el inventario final "
                f"NO se podrá restar completo (posible desfase). "
                f"Reintenta con forzar=true tras revisar embarques."
            ),
        )

    # 1) PRIMERO devolver bins a desverdizado / piso melón — por lote y fecha de corte
    bins_devueltos = 0
    detalle_bins_devueltos: list[dict] = []
    for c in consumos:
        b = int(c.get("bins") or 0)
        lo = _norm_lote(c.get("lote"))
        if b > 0 and lo:
            fr = c.get("fecha_recepcion")
            _devolver_bins_lote(db, lo, b, fr, producto=emp.producto)
            bins_devueltos += b
            item = {"lote": lo, "bins": b}
            if fr:
                item["fecha_recepcion"] = fr
            detalle_bins_devueltos.append(item)

    # 2) Restar producción del inventario final (cartón, RPC, granel, jugo…)
    #    best_effort al forzar: revierte CADA línea posible (antes se abortaba en la
    #    primera falta y quedaba granel/cartón del proceso en inventario).
    stock_final_ok = True
    produccion_revertida: list[dict] = []
    problemas_rev: list[str] = []
    if produccion:
        try:
            produccion_revertida, problemas_rev = _ajustar_inventario_final(
                db,
                emp.producto,
                emp.mercado,
                produccion,
                signo=-1,
                best_effort=bool(forzar),
            )
        except HTTPException as e:
            if e.status_code == 400 and forzar:
                # Seguridad: reintentar línea a línea en best_effort
                produccion_revertida, problemas_rev = _ajustar_inventario_final(
                    db,
                    emp.producto,
                    emp.mercado,
                    produccion,
                    signo=-1,
                    best_effort=True,
                )
                if not problemas_rev:
                    problemas_rev = [str(e.detail)]
            else:
                raise
        if problemas_rev:
            stock_final_ok = False
            detalle["aviso_anulacion"] = " | ".join(problemas_rev)

    if problemas_final and forzar and not stock_final_ok:
        # Mantener pre-check en el aviso si aporta contexto extra
        extra_pre = [p for p in problemas_final if p not in (detalle.get("aviso_anulacion") or "")]
        if extra_pre and not problemas_rev:
            detalle["aviso_anulacion"] = " | ".join(problemas_final)
            stock_final_ok = False

    # 3) Conversión granel→final: devolver el granel consumido (SIEMPRE, no silenciar)
    granel_devuelto = 0
    if detalle.get("tipo") == "conversion_rpc_granel":
        consumos_g = _norm_consumos_granel(detalle.get("consumos_granel") or [])
        if not consumos_g:
            # Compat: líneas crudas sin normalizar
            raw_g = detalle.get("consumos_granel") or []
            consumos_g = []
            for g in raw_g:
                if not isinstance(g, dict):
                    continue
                cant = int(g.get("cantidad") or 0)
                if cant <= 0:
                    continue
                row = {
                    "presentacion": "rpc_granel",
                    "talla": _talla_for_pres("rpc_granel", g.get("talla")),
                    "cantidad": cant,
                }
                lo = _norm_lote_extra(g.get("lote"))
                fe = _norm_fecha_emp(g.get("fecha_empaque") or g.get("fecha"))
                if lo:
                    row["lote"] = lo
                if fe:
                    row["fecha_empaque"] = fe
                consumos_g.append(row)
        if consumos_g:
            _ajustar_inventario_final(
                db, emp.producto, emp.mercado, consumos_g, signo=+1
            )
            granel_devuelto = sum(int(g.get("cantidad") or 0) for g in consumos_g)

    # Marcar si el inventario final quedó como antes del proceso
    n_prod = sum(1 for p in (produccion or []) if int(p.get("cantidad") or 0) > 0)
    n_rev_ok = sum(
        1
        for r in produccion_revertida
        if int(r.get("cantidad") or 0) >= int(r.get("solicitado") or r.get("cantidad") or 0)
    )
    if produccion and not stock_final_ok:
        pass  # ya marcado
    elif produccion and n_prod > 0 and n_rev_ok < n_prod:
        stock_final_ok = False

    detalle = {
        **detalle,
        "consumos": consumos,
        "produccion": produccion,
        "bins_campo": bins_devueltos or detalle.get("bins_campo") or emp.bins_desverdizado_usados,
        "anulado": True,
        "anulado_por": getattr(current_user, "username", None),
        "bins_devueltos": bins_devueltos,
        "detalle_bins_devueltos": detalle_bins_devueltos,
        "produccion_revertida": produccion_revertida,
        "inventario_final_ok": bool(stock_final_ok),
        "granel_devuelto": granel_devuelto,
        "anulado_forzado": bool(forzar and not stock_final_ok),
    }
    emp.detalle_corrida = detalle
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()

    # Mensaje multi-lote explícito (evitar “solo vi 38” cuando hubo 38+28)
    if detalle_bins_devueltos:
        partes = [f"{d['lote']}: {d['bins']}" for d in detalle_bins_devueltos]
        msg = (
            f"Empaque anulado. Bins devueltos a desverdizado: "
            f"{bins_devueltos} total ({', '.join(partes)})"
        )
    else:
        msg = f"Empaque anulado; {bins_devueltos} bins devueltos a desverdizado"
    if granel_devuelto > 0:
        msg += f"; {granel_devuelto} RPC a granel devueltos a inventario"
    if produccion_revertida:
        n_u = sum(int(r.get("cantidad") or 0) for r in produccion_revertida)
        msg += f"; inventario final revertido: {n_u} u. (granel/cartón/RPC/jugo)"
    if detalle.get("aviso_anulacion"):
        msg += f" (aviso: {detalle['aviso_anulacion']})"
    if stock_final_ok and produccion:
        msg += "; estado de inventarios restaurado"
    if (
        bins_devueltos <= 0
        and granel_devuelto <= 0
        and not produccion_revertida
        and detalle.get("tipo") != "conversion_rpc_granel"
    ):
        msg += " — no se encontraron consumos de bins en el registro"
    if detalle.get("tipo") == "conversion_rpc_granel" and granel_devuelto <= 0:
        msg += " — no se pudo devolver granel (sin consumos_granel en el registro)"
    return AnularEmpaqueResponse(
        message=msg,
        id=empaque_id,
        bins_devueltos=bins_devueltos,
        stock_final_revertido=stock_final_ok,
        forzado=bool(forzar and not stock_final_ok),
        aviso=detalle.get("aviso_anulacion"),
        detalle_bins_devueltos=detalle_bins_devueltos,
    )


@router.post("/{empaque_id}/reparar-devolucion-anulacion")
def reparar_devolucion_anulacion(
    empaque_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Repara un empaque YA anulado que no revirtió todo el estado previo:
    - bins de campo a desverdizado
    - producción en inventario final (cartón, RPC, granel WIP, jugo)
    - granel consumido en conversiones

    Idempotente: solo aplica lo que aún falte.
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    detalle = _detalle_as_dict(emp.detalle_corrida)
    if not detalle.get("anulado"):
        raise HTTPException(
            status_code=400,
            detail="Solo aplica a empaques anulados. Usa POST /anular para anular.",
        )

    acciones: list[str] = []
    bins_devueltos = 0
    granel_devuelto = 0
    prod_extra: list[dict] = []

    # Bins de campo
    consumos = _inferir_fechas_consumos_legacy(
        db, _consumos_desde_empaque(emp, detalle)
    )
    prev_bins = int(detalle.get("bins_devueltos") or 0)
    if consumos and prev_bins <= 0:
        for c in consumos:
            b = int(c.get("bins") or 0)
            lo = _norm_lote(c.get("lote"))
            if b > 0 and lo:
                _devolver_bins_lote(db, lo, b, c.get("fecha_recepcion"))
                bins_devueltos += b
        if bins_devueltos > 0:
            acciones.append(f"{bins_devueltos} bins → desverdizado")
            detalle["bins_devueltos"] = bins_devueltos
            detalle["consumos"] = consumos
            detalle["detalle_bins_devueltos"] = [
                {
                    "lote": _norm_lote(c.get("lote")),
                    "bins": int(c.get("bins") or 0),
                    **(
                        {"fecha_recepcion": c["fecha_recepcion"]}
                        if c.get("fecha_recepcion")
                        else {}
                    ),
                }
                for c in consumos
                if int(c.get("bins") or 0) > 0 and _norm_lote(c.get("lote"))
            ]

    # Producción del empaque aún en inventario final (granel/cartón/jugo no restados)
    # Si anulación forzada abortó a medias, completar la resta best-effort.
    prev_rev = detalle.get("produccion_revertida") or []
    ya_rev: dict[tuple, int] = {}
    for r in prev_rev:
        key = (
            (r.get("presentacion") or "").strip(),
            _talla_for_pres(r.get("presentacion"), r.get("talla")),
            _norm_lote_extra(r.get("lote")),
            _norm_fecha_emp(r.get("fecha_empaque") or r.get("fecha")),
        )
        ya_rev[key] = ya_rev.get(key, 0) + int(r.get("cantidad") or 0)

    produccion = _norm_produccion(detalle.get("produccion"))
    pendiente: list[dict] = []
    for p in produccion:
        key = (
            (p.get("presentacion") or "").strip(),
            _talla_for_pres(p.get("presentacion"), p.get("talla")),
            _norm_lote_extra(p.get("lote")),
            _norm_fecha_emp(p.get("fecha_empaque") or p.get("fecha")),
        )
        sol = int(p.get("cantidad") or 0)
        hecho = int(ya_rev.get(key, 0))
        # Si no hay registro de reverso (anulación vieja), asumir 0 y restar lo que quede en stock
        falta = max(0, sol - hecho) if prev_rev else sol
        if falta <= 0:
            continue
        # Si ya se marcó inventario_final_ok, no re-restar
        if detalle.get("inventario_final_ok") is True and prev_rev:
            continue
        pendiente.append({**p, "cantidad": falta})

    # Anulaciones viejas sin produccion_revertida: el bug abortaba en la 1ª línea
    # sin stock (p.ej. granel 140) y dejaba granel/jugo posteriores. El cartón
    # SÍ se restaba antes del fallo → no re-restar cartón/RPC final.
    if not prev_rev and produccion and detalle.get("inventario_final_ok") is not True:
        if detalle.get("anulado_forzado") or detalle.get("aviso_anulacion"):
            pendiente = [
                p
                for p in produccion
                if (p.get("presentacion") or "").strip()
                in ("rpc_granel", "bins_jugo")
            ]

    if pendiente:
        prod_extra, probs = _ajustar_inventario_final(
            db,
            emp.producto,
            emp.mercado,
            pendiente,
            signo=-1,
            best_effort=True,
        )
        if prod_extra:
            total_u = sum(int(x.get("cantidad") or 0) for x in prod_extra)
            acciones.append(f"{total_u} u. producción → restadas de inventario final")
            merged = list(prev_rev) + prod_extra
            detalle["produccion_revertida"] = merged
            # ¿quedó completo?
            ok = not probs and all(
                int(x.get("cantidad") or 0)
                >= int(x.get("solicitado") or x.get("cantidad") or 0)
                for x in merged
            )
            # Comprobar por SKU vs producción original
            rev_tot: dict[tuple, int] = {}
            for r in merged:
                k = (
                    (r.get("presentacion") or "").strip(),
                    _talla_for_pres(r.get("presentacion"), r.get("talla")),
                    _norm_lote_extra(r.get("lote")),
                    _norm_fecha_emp(r.get("fecha_empaque") or r.get("fecha")),
                )
                rev_tot[k] = rev_tot.get(k, 0) + int(r.get("cantidad") or 0)
            completo = True
            for p in produccion:
                k = (
                    (p.get("presentacion") or "").strip(),
                    _talla_for_pres(p.get("presentacion"), p.get("talla")),
                    _norm_lote_extra(p.get("lote")),
                    _norm_fecha_emp(p.get("fecha_empaque") or p.get("fecha")),
                )
                if rev_tot.get(k, 0) < int(p.get("cantidad") or 0):
                    completo = False
                    break
            detalle["inventario_final_ok"] = completo and not probs
            if probs:
                detalle["aviso_anulacion"] = " | ".join(probs)
            elif completo:
                detalle.pop("aviso_anulacion", None)
                detalle["anulado_forzado"] = False

    # Granel de conversión
    if detalle.get("tipo") == "conversion_rpc_granel":
        prev_g = int(detalle.get("granel_devuelto") or 0)
        consumos_g = _norm_consumos_granel(detalle.get("consumos_granel") or [])
        if consumos_g and prev_g <= 0:
            _ajustar_inventario_final(
                db, emp.producto, emp.mercado, consumos_g, signo=+1
            )
            granel_devuelto = sum(int(g.get("cantidad") or 0) for g in consumos_g)
            if granel_devuelto > 0:
                acciones.append(f"{granel_devuelto} RPC granel → inventario")
                detalle["granel_devuelto"] = granel_devuelto

    if not acciones:
        return {
            "message": (
                f"Empaque #{empaque_id} ya tenía devoluciones registradas "
                f"(bins_devueltos={detalle.get('bins_devueltos')}, "
                f"granel_devuelto={detalle.get('granel_devuelto')}). Nada que reparar."
            ),
            "id": empaque_id,
            "bins_devueltos": 0,
            "granel_devuelto": 0,
        }

    detalle["reparacion_devolucion_por"] = getattr(current_user, "username", None)
    emp.detalle_corrida = detalle
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()
    return {
        "message": f"Reparación OK: {'; '.join(acciones)}",
        "id": empaque_id,
        "bins_devueltos": bins_devueltos,
        "granel_devuelto": granel_devuelto,
        "ejecutado_por": getattr(current_user, "username", None),
    }


@router.delete("/{empaque_id}", response_model=EliminarEmpaqueResponse)
def eliminar_empaque_anulado(
    empaque_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Borra permanentemente un empaque ya anulado (limpia historial).
    No toca inventarios: al anular ya se revirtieron.
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")

    detalle = _detalle_as_dict(emp.detalle_corrida)
    if not detalle.get("anulado"):
        raise HTTPException(
            status_code=400,
            detail=(
                "Solo se pueden borrar empaques ANULADOS. "
                "Primero anula el empaque (revierte inventario) y luego bórralo."
            ),
        )

    db.delete(emp)
    db.commit()
    return EliminarEmpaqueResponse(
        message=f"Empaque #{empaque_id} borrado del historial",
        id=empaque_id,
    )


def _norm_consumos_granel(raw: list | None) -> list[dict]:
    """[{"talla","lote","fecha_empaque","cantidad"}] → líneas rpc_granel."""
    out = []
    for c in raw or []:
        cant = int(c.get("cantidad") or 0)
        if cant <= 0:
            continue
        talla_val = _talla_for_pres("rpc_granel", c.get("talla"))
        lote_val = _norm_lote_extra(c.get("lote"))
        fecha_val = _norm_fecha_emp(c.get("fecha_empaque") or c.get("fecha"))
        row = {
            "presentacion": "rpc_granel",
            "talla": talla_val,
            "cantidad": cant,
        }
        if lote_val:
            row["lote"] = lote_val
        if fecha_val:
            row["fecha_empaque"] = fecha_val
        out.append(row)
    return out


@router.post("/convertir-granel", response_model=ConvertirGranelResponse)
def convertir_rpc_granel(
    body: ConvertirGranelRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN, Rol.RECEPCION_EMPACADOR, Rol.EMPACADOR])),
):
    """
    Consume RPC a granel (22 kg, por talla y lote) y produce RPC 12/18 o cartón.
    El producto final hereda el lote de origen del granel consumido.
    """
    fecha_emp = _parse_fecha_empaque(body.fecha)
    if not fecha_emp:
        raise HTTPException(
            status_code=400,
            detail="La fecha de empaque es obligatoria (formato YYYY-MM-DD)",
        )

    consumos_g = _norm_consumos_granel(body.consumos_granel)
    if not consumos_g and body.cantidad_rpc_granel > 0:
        consumos_g = [
            {
                "presentacion": "rpc_granel",
                "talla": None,
                "cantidad": int(body.cantidad_rpc_granel),
            }
        ]
    if not consumos_g:
        raise HTTPException(
            status_code=400,
            detail="Indica consumos de RPC a granel por talla y lote",
        )
    for c in consumos_g:
        if not c.get("lote"):
            raise HTTPException(
                status_code=400,
                detail="Cada consumo de granel debe indicar el lote de origen",
            )
        if not c.get("fecha_empaque"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cada consumo de granel debe indicar la fecha de empaque "
                    "del día en que se generó (para no mezclar corridas)"
                ),
            )

    produccion = _norm_produccion(body.produccion)
    if not produccion:
        raise HTTPException(status_code=400, detail="Indica producción final (RPC o cartón)")
    for p in produccion:
        if p["presentacion"] in ("rpc_granel", "bins_jugo"):
            raise HTTPException(
                status_code=400,
                detail="La conversión debe producir RPC 12/18 o cartón (no granel ni jugo)",
            )

    # Heredar lote del granel; fecha de la conversión = día actual de corrida
    lotes_g = sorted({c.get("lote") for c in consumos_g if c.get("lote")})
    for p in produccion:
        if not p.get("lote"):
            if len(lotes_g) == 1:
                p["lote"] = lotes_g[0]
        if not p.get("fecha_empaque"):
            p["fecha_empaque"] = str(fecha_emp)

    total_granel = sum(int(c["cantidad"]) for c in consumos_g)

    # 1) Descontar RPC a granel por talla + lote
    _ajustar_inventario_final(
        db,
        Producto.LIMON_AMARILLO,
        body.mercado,
        consumos_g,
        signo=-1,
    )
    # 2) Sumar producción final (con lote heredado)
    _ajustar_inventario_final(db, Producto.LIMON_AMARILLO, body.mercado, produccion, signo=+1)

    # 3) Auditoría
    lotes_resumen = ", ".join(
        f"granel {c.get('lote') or '?'}#{c['talla'] or 's/t'}"
        f"@{c.get('fecha_empaque') or '?'}:{c['cantidad']}"
        for c in consumos_g
    )
    detalle = {
        "tipo": "conversion_rpc_granel",
        "consumos": [],
        "consumos_granel": consumos_g,
        "produccion": produccion,
        "bins_campo": 0,
        "lotes_resumen": lotes_resumen,
        "notas": body.notas,
    }
    nuevo = Empaque(
        producto=Producto.LIMON_AMARILLO,
        fecha=fecha_emp,
        variedad=None,
        tipo_cultivo=None,
        mercado=body.mercado,
        cantidad_cajas_campo_usadas=0,
        cantidad_cajas_carton_producidas=0,
        porcentaje_merma=0.0,
        numero_empacador=body.numero_empacador or "EMP-01",
        bins_desverdizado_usados=0,
        lote_desverdizado=lotes_g[0] if len(lotes_g) == 1 else None,
        detalle_corrida=detalle,
        usuario_id=getattr(current_user, "id", None),
    )
    _sync_legacy_empaque_fields(
        nuevo,
        produccion=produccion,
        consumos=[],
        bins_usados=0,
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return ConvertirGranelResponse(
        message=(
            f"Convertidos {total_granel} RPC a granel → "
            f"{sum(p['cantidad'] for p in produccion)} unidades finales"
        ),
        empaque_id=nuevo.id,
        rpc_granel_consumido=total_granel,
        consumos_granel=consumos_g,
        produccion=produccion,
    )
