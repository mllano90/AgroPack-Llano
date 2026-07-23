import { useState, useEffect, type CSSProperties } from 'react';
import {
  getEmpaquesAdmin,
  anularEmpaque,
  eliminarEmpaqueAnulado,
  editarEmpaqueCompleto,
  getDesverdizadoAdmin,
  eliminarDesverdizado,
  editarDesverdizado,
  getHistorialMovimientos,
  eliminarRecepcionAdmin,
  eliminarEmbarqueAdmin,
  editarRecepcionLimon,
  sincronizarRecepcionDesverdizado,
  getEmbarques,
  type DesverdizadoAdminItem,
  type HistorialMovimiento,
} from '../../lib/api';
import {
  DIAS_DESVERDIZADO,
  PRESENTACIONES_LIMON,
  TALLAS_LIMON,
  labelPresentacionLimon,
} from '../../lib/constants';
import { formatFechaCorta, toInputDate } from '../../lib/dates';
import type { EmpaqueRecord } from '../../types';
import InventariosAdmin from './InventariosAdmin';

type EmbarqueAdminRow = {
  id: number;
  fecha_salida: string;
  cliente_id: number;
  notas?: string | null;
  estado: string;
  detalles: Array<{
    producto: string;
    mercado: string;
    cantidad_cajas: number;
    presentacion?: string | null;
    talla?: string | null;
    calidad?: string | null;
  }>;
};

type ConsumoEdit = { lote: string; bins: string };
type ProdEdit = { presentacion: string; talla: string; cantidad: string };

interface CorreccionesProps {
  token: string;
  onCorregido?: () => void;
}

function formatFecha(fecha: string) {
  return formatFechaCorta(fecha);
}

function labelProducto(p: string) {
  if (p === 'limon_amarillo') return 'Limón amarillo';
  if (p === 'uva') return 'Uva';
  return p;
}

export default function Correcciones({ token, onCorregido }: CorreccionesProps) {
  const [empaques, setEmpaques] = useState<EmpaqueRecord[]>([]);
  const [desverdizado, setDesverdizado] = useState<DesverdizadoAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Borrador edición empaque
  const [editFecha, setEditFecha] = useState('');
  const [editEmpacador, setEditEmpacador] = useState('');
  const [editMercado, setEditMercado] = useState<'nacional' | 'exportacion'>('nacional');
  const [editConsumos, setEditConsumos] = useState<ConsumoEdit[]>([]);
  const [editProduccion, setEditProduccion] = useState<ProdEdit[]>([]);

  // Edición desverdizado
  const [editDesv, setEditDesv] = useState<DesverdizadoAdminItem | null>(null);
  const [editLote, setEditLote] = useState('');
  const [editBins, setEditBins] = useState('');
  const [editFechaCorte, setEditFechaCorte] = useState('');
  const [editFechaTent, setEditFechaTent] = useState('');
  const [editEstado, setEditEstado] = useState('en_desverdizado');
  const [editRecalc, setEditRecalc] = useState(true);

  // Historial unificado
  const [historial, setHistorial] = useState<HistorialMovimiento[]>([]);
  const [filtroModulo, setFiltroModulo] = useState<string>('recepcion');
  const [vistaSeccion, setVistaSeccion] = useState<
    'historial' | 'empaques' | 'embarques' | 'desverdizado' | 'inventarios'
  >('historial');
  const [embarquesList, setEmbarquesList] = useState<EmbarqueAdminRow[]>([]);
  const [embSelId, setEmbSelId] = useState<number | null>(null);

  // Edición recepción limón (lote / bins / fecha)
  const [editRec, setEditRec] = useState<HistorialMovimiento | null>(null);
  const [editRecLote, setEditRecLote] = useState('');
  const [editRecBins, setEditRecBins] = useState('');
  const [editRecFecha, setEditRecFecha] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [list, desv, hist, embs] = await Promise.all([
        getEmpaquesAdmin(token),
        getDesverdizadoAdmin(token).catch(() => [] as DesverdizadoAdminItem[]),
        getHistorialMovimientos(token, filtroModulo, 200).catch(() => ({
          total: 0,
          items: [] as HistorialMovimiento[],
        })),
        getEmbarques(token).catch(() => [] as EmbarqueAdminRow[]),
      ]);
      setEmpaques(list);
      setDesverdizado(Array.isArray(desv) ? desv : []);
      setHistorial(hist.items || []);
      setEmbarquesList(Array.isArray(embs) ? (embs as EmbarqueAdminRow[]) : []);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : err?.response?.status === 403
            ? 'Solo administradores pueden ver correcciones.'
            : 'Error cargando datos'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token, filtroModulo]);

  const selected = empaques.find((e) => e.id === selectedId) || null;
  const anulado = Boolean(selected?.detalle_corrida?.anulado);

  const loadEmpaqueDraft = (e: EmpaqueRecord) => {
    setSelectedId(e.id);
    setEditFecha(toInputDate(e.fecha));
    setEditEmpacador(e.numero_empacador || '');
    setEditMercado((e.mercado as 'nacional' | 'exportacion') || 'nacional');
    const cons =
      e.detalle_corrida?.consumos ||
      (e.lote_desverdizado
        ? [{ lote: e.lote_desverdizado, bins: e.bins_desverdizado_usados || 0 }]
        : []);
    setEditConsumos(
      cons.map((c) => ({ lote: String(c.lote || ''), bins: String(c.bins ?? '') }))
    );
    const prod = e.detalle_corrida?.produccion || [];
    setEditProduccion(
      prod.map((p) => ({
        presentacion: String(p.presentacion || ''),
        talla: p.talla != null ? String(p.talla) : '',
        cantidad: String(p.cantidad ?? ''),
      }))
    );
    setOkMsg('');
    setError('');
  };

  const handleGuardarEmpaque = async () => {
    if (!selectedId || !selected) return;
    if (selected.producto !== 'limon_amarillo') {
      return alert('Edición completa solo para limón por ahora');
    }
    if (anulado) return alert('El empaque está anulado');

    const consumos = editConsumos
      .map((c) => ({ lote: c.lote.trim(), bins: parseInt(c.bins, 10) || 0 }))
      .filter((c) => c.lote && c.bins > 0);
    const produccion = editProduccion
      .map((p) => ({
        presentacion: p.presentacion.trim(),
        talla: p.presentacion === 'bins_jugo' ? null : p.talla.trim() || null,
        cantidad: parseInt(p.cantidad, 10) || 0,
      }))
      .filter((p) => p.presentacion && p.cantidad > 0);

    if (consumos.length === 0) return alert('Debe haber al menos un lote con bins > 0');
    if (produccion.length === 0) return alert('Debe haber al menos una línea de producción');

    if (
      !confirm(
        `¿Guardar cambios del empaque #${selectedId}?\n\n` +
          `Se ajustarán desverdizado e inventario final según los nuevos datos.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const updated = await editarEmpaqueCompleto(token, selectedId, {
        consumos,
        produccion,
        fecha: editFecha || null,
        numero_empacador: editEmpacador || null,
        mercado: editMercado,
      });
      setOkMsg(`Empaque #${selectedId} actualizado`);
      await load();
      // recargar draft desde lista actualizada
      const again = (await getEmpaquesAdmin(token)).find((x) => x.id === selectedId);
      if (again) loadEmpaqueDraft(again);
      else if (updated) loadEmpaqueDraft(updated as EmpaqueRecord);
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo guardar el empaque');
    } finally {
      setBusy(false);
    }
  };

  const handleAnular = async () => {
    if (!selectedId || !selected) return;
    if (selected.producto !== 'limon_amarillo') {
      return alert('Por ahora solo se pueden anular empaques de limón.');
    }
    if (anulado) return alert('Este empaque ya está anulado.');

    if (
      !confirm(
        `¿ANULAR empaque #${selectedId}?\n\nSe devolverán los bins a desverdizado y se restará la producción del inventario final.\nEsta acción es irreversible desde la UI.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await anularEmpaque(token, selectedId, false);
      setOkMsg(res.message || `Empaque #${selectedId} anulado`);
      await load();
      onCorregido?.();
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || 'No se pudo anular el empaque';
      if (status === 409) {
        const forzarOk = confirm(
          `No se puede anular de forma limpia:\n\n${detail}\n\n` +
            `¿FORZAR anulación?\n` +
            `• Se devolverán bins a desverdizado\n` +
            `• El inventario final NO se restará completo (posible desfase)\n` +
            `Usa esto solo si ya revisaste embarques.`
        );
        if (forzarOk) {
          try {
            const res2 = await anularEmpaque(token, selectedId, true);
            setOkMsg(res2.message || `Empaque #${selectedId} anulado (forzado)`);
            await load();
            onCorregido?.();
          } catch (err2: any) {
            setError(err2?.response?.data?.detail || 'No se pudo forzar la anulación');
          }
        } else {
          setError(typeof detail === 'string' ? detail : 'Anulación cancelada');
        }
      } else {
        setError(typeof detail === 'string' ? detail : 'No se pudo anular el empaque');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBorrarAnulado = async (empaqueId?: number) => {
    const id = empaqueId ?? selectedId;
    if (!id) return;
    if (
      !confirm(
        `¿BORRAR permanentemente empaque anulado #${id}?\n\n` +
          `Se elimina del historial. No cambia inventarios (ya se revirtieron al anular).\n` +
          `Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await eliminarEmpaqueAnulado(token, id);
      setOkMsg(res.message || `Empaque #${id} borrado`);
      if (selectedId === id) {
        setSelectedId(null);
      }
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo borrar el empaque');
    } finally {
      setBusy(false);
    }
  };

  const openEditDesverdizado = (d: DesverdizadoAdminItem) => {
    setEditDesv(d);
    setEditLote(d.lote || '');
    setEditBins(String(d.cantidad_bins_disponibles ?? 0));
    setEditFechaCorte(toInputDate(d.fecha_recepcion));
    setEditFechaTent(toInputDate(d.fecha_tentativa_salida));
    setEditEstado(d.estado || 'en_desverdizado');
    setEditRecalc(true);
    setOkMsg('');
    setError('');
  };

  const cancelEditDesverdizado = () => {
    setEditDesv(null);
  };

  const handleGuardarDesverdizado = async () => {
    if (!editDesv) return;
    const binsNum = parseInt(editBins, 10);
    if (!editLote.trim()) return alert('El lote no puede quedar vacío');
    if (isNaN(binsNum) || binsNum < 0) return alert('Bins debe ser un número ≥ 0');

    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await editarDesverdizado(token, editDesv.id, {
        lote: editLote.trim(),
        cantidad_bins: binsNum,
        fecha_recepcion: editFechaCorte || null,
        fecha_tentativa_salida: editRecalc ? null : editFechaTent || null,
        estado: editEstado,
        recalcular_tentativa: editRecalc,
      });
      setOkMsg(res.message || `Registro #${editDesv.id} actualizado`);
      setEditDesv(null);
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo editar el desverdizado');
    } finally {
      setBusy(false);
    }
  };

  const handleHistorialEliminar = async (m: HistorialMovimiento) => {
    if (m.modulo === 'empaque') {
      const yaAnulado = Boolean(m.meta?.anulado);
      if (yaAnulado) {
        await handleBorrarAnulado(m.id);
        return;
      }
      if (
        !confirm(
          `¿Anular empaque #${m.id}?\n\nRevierte inventario de limón.\n` +
            `Después podrás borrarlo del historial si ya no lo necesitas.`
        )
      ) {
        return;
      }
      setBusy(true);
      setError('');
      setOkMsg('');
      try {
        const res = await anularEmpaque(token, m.id, false);
        setOkMsg(res.message || `Empaque #${m.id} anulado`);
        await load();
        onCorregido?.();
      } catch (err: any) {
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail || 'No se pudo anular el empaque';
        if (status === 409) {
          const forzarOk = confirm(
            `No se puede anular de forma limpia:\n\n${detail}\n\n` +
              `¿FORZAR anulación?\n` +
              `• Se devolverán bins a desverdizado\n` +
              `• El inventario final NO se restará completo (posible desfase)`
          );
          if (forzarOk) {
            try {
              const res2 = await anularEmpaque(token, m.id, true);
              setOkMsg(res2.message || `Empaque #${m.id} anulado (forzado)`);
              await load();
              onCorregido?.();
            } catch (err2: any) {
              setError(err2?.response?.data?.detail || 'No se pudo forzar la anulación');
            }
          } else {
            setError(typeof detail === 'string' ? detail : 'Anulación cancelada');
          }
        } else {
          setError(typeof detail === 'string' ? detail : 'No se pudo anular el empaque');
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (m.modulo === 'desverdizado') {
      const d = desverdizado.find((x) => x.id === m.id);
      if (d) {
        await handleEliminarDesverdizado(d, true);
      } else {
        // sin stock en lista admin; intentar borrar por id
        setBusy(true);
        try {
          const res = await eliminarDesverdizado(token, m.id, false);
          setOkMsg(res.message);
          await load();
          onCorregido?.();
        } catch (err: any) {
          setError(err?.response?.data?.detail || 'No se pudo eliminar desverdizado');
        } finally {
          setBusy(false);
        }
      }
      return;
    }
    if (m.modulo === 'recepcion') {
      const meta = m.meta || {};
      const lote = meta.lote ? String(meta.lote) : '—';
      const bins = meta.cantidad_bins ?? '—';
      const corte = meta.fecha_corte || m.fecha || '—';
      const desvIds = Array.isArray(meta.desverdizado_ids)
        ? meta.desverdizado_ids.join(', ')
        : '—';
      if (
        !confirm(
          `¿Eliminar recepción #${m.id}?\n\n` +
            `Fecha corte/recepción: ${corte}\n` +
            `Lote: ${lote}\n` +
            `Bins recibidos: ${bins}\n` +
            `Desverdizado ID(s): ${desvIds}\n\n` +
            `Uva: revierte inventario.\n` +
            `Limón: también elimina el desverdizado ligado (mismos bins en cámara).`
        )
      ) {
        return;
      }
      setBusy(true);
      setError('');
      setOkMsg('');
      try {
        const res = await eliminarRecepcionAdmin(token, m.id);
        setOkMsg(res.message);
        await load();
        onCorregido?.();
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'No se pudo eliminar la recepción');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (m.modulo === 'embarque') {
      await eliminarEmbarqueConConfirm(m.id, m.detalle || m.resumen);
    }
  };

  const eliminarEmbarqueConConfirm = async (id: number, detalleHint?: string) => {
    if (
      !confirm(
        `¿Eliminar embarque #${id} y devolver inventario?\n\n` +
          `${detalleHint ? detalleHint + '\n\n' : ''}` +
          `Las cajas/bins vuelven al inventario final (mismas presentaciones y tallas).\n` +
          `Esta acción no se puede deshacer (el embarque se borra del historial).`
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await eliminarEmbarqueAdmin(token, id);
      const rest = (res as { restaurado?: Array<Record<string, unknown>> }).restaurado || [];
      const lines = rest
        .filter((r) => r.ok)
        .map((r) => {
          const sku = [r.presentacion, r.talla ? `#${r.talla}` : '']
            .filter(Boolean)
            .join(' ');
          return `  · ${sku || r.producto || 'item'}: ${r.antes} → ${r.despues} (+${r.delta})${
            r.created ? ' [NUEVA LÍNEA]' : ''
          }`;
        });
      setOkMsg(
        `${res.message}` + (lines.length ? `\n${lines.join('\n')}` : '')
      );
      if (embSelId === id) setEmbSelId(null);
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo eliminar el embarque');
    } finally {
      setBusy(false);
    }
  };

  const handleHistorialEditar = (m: HistorialMovimiento) => {
    if (m.modulo === 'recepcion') {
      const meta = m.meta || {};
      setEditRec(m);
      setEditRecLote(String(meta.lote || ''));
      setEditRecBins(String(meta.cantidad_bins ?? meta.bins_desverdizado_actual ?? 0));
      setEditRecFecha(toInputDate((meta.fecha_corte as string) || m.fecha));
      setOkMsg('');
      setError('');
      return;
    }
    if (m.modulo === 'desverdizado') {
      // Compat: redirigir a recepción si hay recepcion_id
      const rid = m.meta?.recepcion_id as number | undefined;
      if (rid) {
        const fake: HistorialMovimiento = {
          ...m,
          modulo: 'recepcion',
          id: rid,
        };
        handleHistorialEditar(fake);
        return;
      }
      const d = desverdizado.find((x) => x.id === m.id);
      if (d) {
        openEditDesverdizado(d);
        setVistaSeccion('desverdizado');
      }
      return;
    }
    if (m.modulo === 'empaque') {
      setVistaSeccion('empaques');
      const emp = empaques.find((x) => x.id === m.id);
      if (emp) {
        loadEmpaqueDraft(emp);
        setOkMsg(`Empaque #${m.id} listo para editar abajo.`);
      } else {
        setSelectedId(m.id);
        setOkMsg(`Empaque #${m.id} — actualiza la lista si no aparece el formulario.`);
      }
    }
  };

  const handleGuardarRecepcion = async () => {
    if (!editRec) return;
    const binsNum = parseInt(editRecBins, 10);
    if (!editRecLote.trim()) return alert('Indica el lote');
    if (isNaN(binsNum) || binsNum < 0) return alert('Bins inválido');
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await editarRecepcionLimon(token, editRec.id, {
        lote: editRecLote.trim(),
        cantidad_bins: binsNum,
        fecha_corte: editRecFecha || null,
        recalcular_tentativa: true,
      });
      setOkMsg((res as any).message || `Recepción #${editRec.id} actualizada`);
      setEditRec(null);
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo editar la recepción');
    } finally {
      setBusy(false);
    }
  };

  const handleEliminarDesverdizado = async (d: DesverdizadoAdminItem, soloEste = false) => {
    const mismos = desverdizado.filter((x) => (x.lote || '').trim() === (d.lote || '').trim());
    const binsTotal = mismos.reduce((s, x) => s + (x.cantidad_bins_disponibles || 0), 0);
    const msg = soloEste
      ? `¿Eliminar solo el registro #${d.id} (lote "${d.lote}", ${d.cantidad_bins_disponibles} bins)?`
      : `¿Eliminar el lote "${d.lote}" de desverdizado en TODO el sistema?\n\n` +
        `Registros: ${mismos.length} · Bins totales: ${binsTotal}\n` +
        `(Si el mismo lote se recibió varias veces, se borran todas las filas.)\n\n` +
        `Desaparecerá de Empaque, Inventarios y Proyección.`;
    if (!confirm(msg)) return;

    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await eliminarDesverdizado(token, d.id, !soloEste);
      setOkMsg(res.message || `Lote ${d.lote} eliminado`);
      if (editDesv?.id === d.id) setEditDesv(null);
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo eliminar el lote de desverdizado');
    } finally {
      setBusy(false);
    }
  };

  const moduloLabel = (m: string) => {
    const map: Record<string, string> = {
      recepcion: 'Recepción',
      desverdizado: 'Desverdizado',
      empaque: 'Empaque',
      embarque: 'Embarque',
    };
    return map[m] || m;
  };

  const moduloColor = (m: string) => {
    const map: Record<string, string> = {
      recepcion: '#dbeafe',
      desverdizado: '#fef9c3',
      empaque: '#dcfce7',
      embarque: '#fce7f3',
    };
    return map[m] || '#f1f5f9';
  };

  const secBtn = (id: typeof vistaSeccion): CSSProperties => ({
    padding: '8px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: vistaSeccion === id ? 700 : 400,
    background: vistaSeccion === id ? '#15803d' : '#f1f5f9',
    color: vistaSeccion === id ? 'white' : '#334155',
  });

  return (
    <div>
      <h2 style={{ marginBottom: 8 }}>Correcciones (solo admin)</h2>
      <p style={{ color: '#64748b', marginTop: 0, maxWidth: 820 }}>
        <strong>Recepción limón</strong> es donde se capturan lote, bins y fecha de corte; eso alimenta
        el inventario de desverdizado (no es un registro aparte). Edita o elimina desde Recepción.
        Empaque y Embarque se corrigen en sus filtros.
      </p>

      {error && (
        <p style={{ color: '#dc2626', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{error}</p>
      )}
      {okMsg && (
        <pre
          style={{
            color: '#15803d',
            background: '#f0fdf4',
            padding: 12,
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 13,
            margin: '0 0 12px',
          }}
        >
          {okMsg}
        </pre>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" style={secBtn('historial')} onClick={() => setVistaSeccion('historial')}>
          Historial de movimientos
        </button>
        <button type="button" style={secBtn('empaques')} onClick={() => setVistaSeccion('empaques')}>
          Corregir empaques
        </button>
        <button
          type="button"
          style={secBtn('embarques')}
          onClick={() => setVistaSeccion('embarques')}
        >
          Corregir embarques
        </button>
        <button
          type="button"
          style={secBtn('desverdizado')}
          onClick={() => setVistaSeccion('desverdizado')}
        >
          Desverdizado
        </button>
        <button
          type="button"
          style={secBtn('inventarios')}
          onClick={() => setVistaSeccion('inventarios')}
        >
          Inventarios
        </button>
        <button type="button" onClick={load} style={{ padding: '8px 14px', cursor: 'pointer' }}>
          Actualizar
        </button>
      </div>

      {/* ===== HISTORIAL ===== */}
      {vistaSeccion === 'historial' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Filtrar:</strong>
            {(
              [
                ['recepcion', 'Recepción (lote / bins / fecha)'],
                ['empaque', 'Empaque'],
                ['embarque', 'Embarque'],
                ['todos', 'Todos'],
              ] as const
            ).map(([val, lab]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFiltroModulo(val)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: filtroModulo === val ? '#0f172a' : 'white',
                  color: filtroModulo === val ? 'white' : '#0f172a',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {lab}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await sincronizarRecepcionDesverdizado(token);
                  setOkMsg('Recepciones enlazadas con desverdizado (lote/bins/fecha rellenados).');
                  await load();
                } catch (err: any) {
                  setError(err?.response?.data?.detail || 'Error al sincronizar');
                } finally {
                  setBusy(false);
                }
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #15803d',
                background: '#f0fdf4',
                color: '#166534',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Re-enlazar recepción ↔ inventario
            </button>
          </div>

          {editRec && (
            <div
              style={{
                marginBottom: 16,
                padding: 16,
                background: '#f0fdf4',
                border: '1px solid #86efac',
                borderRadius: 10,
              }}
            >
              <h4 style={{ marginTop: 0 }}>Editar recepción #{editRec.id} (lote / bins / fecha)</h4>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
                Esto actualiza también el inventario de desverdizado ligado (misma captura).
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 12,
                }}
              >
                <label style={editLabel}>
                  Lote
                  <input value={editRecLote} onChange={(e) => setEditRecLote(e.target.value)} style={editInput} />
                </label>
                <label style={editLabel}>
                  Bins
                  <input
                    type="number"
                    min={0}
                    value={editRecBins}
                    onChange={(e) => setEditRecBins(e.target.value)}
                    style={editInput}
                  />
                </label>
                <label style={editLabel}>
                  Fecha de corte
                  <input
                    type="date"
                    value={editRecFecha}
                    onChange={(e) => setEditRecFecha(e.target.value)}
                    style={editInput}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGuardarRecepcion}
                  style={{
                    padding: '10px 18px',
                    background: '#15803d',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setEditRec(null)}
                  style={{
                    padding: '10px 18px',
                    background: '#64748b',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p>Cargando historial…</p>
          ) : historial.length === 0 ? (
            <p style={{ color: '#64748b' }}>No hay movimientos para este filtro.</p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={th}>Módulo</th>
                    <th style={th}>Fecha</th>
                    <th style={th}>Registro</th>
                    <th style={th}>Resumen</th>
                    <th style={th}>Detalle</th>
                    <th style={th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((m) => (
                    <tr key={`${m.modulo}-${m.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={td}>
                        <span
                          style={{
                            background: moduloColor(m.modulo),
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontWeight: 600,
                            fontSize: 12,
                            color: '#0f172a',
                          }}
                        >
                          {moduloLabel(m.modulo)}
                        </span>
                      </td>
                      <td style={td}>
                        <strong>{formatFecha(m.fecha || '')}</strong>
                        {m.modulo === 'recepcion' && m.meta?.cantidad_bins != null && (
                          <div style={{ fontSize: 11, color: '#0369a1', marginTop: 2 }}>
                            {String(m.meta.cantidad_bins)} bins
                            {m.meta.lote ? ` · ${String(m.meta.lote)}` : ''}
                          </div>
                        )}
                        {m.modulo === 'desverdizado' && m.meta?.cantidad_bins != null && (
                          <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>
                            {String(m.meta.cantidad_bins)} bins en cámara
                            {m.meta.recepcion_id
                              ? ` · Rec. #${String(m.meta.recepcion_id)}`
                              : ''}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        <strong>{m.titulo}</strong>
                      </td>
                      <td style={td}>{m.resumen}</td>
                      <td style={{ ...td, maxWidth: 320, fontSize: 12, color: '#475569' }}>
                        {m.detalle}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {m.puede_editar && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleHistorialEditar(m)}
                              style={{
                                padding: '5px 10px',
                                background: '#0369a1',
                                color: 'white',
                                border: 'none',
                                borderRadius: 5,
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              Editar / Corregir
                            </button>
                          )}
                          {m.puede_eliminar && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleHistorialEliminar(m)}
                              style={{
                                padding: '5px 10px',
                                background: m.meta?.anulado ? '#7f1d1d' : '#dc2626',
                                color: 'white',
                                border: 'none',
                                borderRadius: 5,
                                cursor: busy ? 'wait' : 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              {m.modulo === 'empaque' && m.meta?.anulado
                                ? 'Borrar'
                                : m.modulo === 'empaque'
                                  ? 'Anular'
                                  : 'Eliminar'}
                            </button>
                          )}
                          {!m.puede_editar && !m.puede_eliminar && (
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
            <strong>Recepción:</strong> Editar = lote, bins y fecha de corte (actualiza desverdizado).
            Eliminar = borra recepción y el inventario de desverdizado ligado.{' '}
            <strong>Empaque:</strong> Anular = revierte inventarios; si ya está anulado, Borrar =
            lo quita del historial.{' '}
            <strong>Embarque:</strong> devuelve stock al inventario final.
          </p>
        </div>
      )}

      {/* ===== EMBARQUES (devolver inventario) ===== */}
      {vistaSeccion === 'embarques' && (
        loading ? (
          <p>Cargando embarques…</p>
        ) : (
          <div>
            <h3 style={{ marginTop: 0 }}>Corregir embarques</h3>
            <p style={{ fontSize: 13, color: '#64748b', maxWidth: 720, marginTop: 0 }}>
              Eliminar un embarque <strong>devuelve</strong> las cajas/bins al inventario final
              (misma presentación y talla). Usa esto si se cargó un manifiesto por error. No crea
              empaques ni recepciones.
            </p>
            {embarquesList.length === 0 ? (
              <p style={{ color: '#64748b' }}>No hay embarques registrados.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fce7f3', textAlign: 'left' }}>
                        <th style={th}>#</th>
                        <th style={th}>Fecha</th>
                        <th style={th}>Cliente id</th>
                        <th style={th}>Cajas</th>
                        <th style={th}>Líneas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {embarquesList
                        .slice()
                        .sort((a, b) => b.id - a.id)
                        .map((e) => {
                          const total = (e.detalles || []).reduce(
                            (s, d) => s + (d.cantidad_cajas || 0),
                            0
                          );
                          const sel = embSelId === e.id;
                          return (
                            <tr
                              key={e.id}
                              onClick={() => setEmbSelId(e.id)}
                              style={{
                                borderBottom: '1px solid #e2e8f0',
                                cursor: 'pointer',
                                background: sel ? '#fdf2f8' : undefined,
                              }}
                            >
                              <td style={td}>
                                <strong>{e.id}</strong>
                              </td>
                              <td style={td}>{e.fecha_salida}</td>
                              <td style={td}>{e.cliente_id}</td>
                              <td style={{ ...td, fontWeight: 700 }}>{total}</td>
                              <td style={td}>{(e.detalles || []).length}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 16,
                    background: '#fff',
                  }}
                >
                  {(() => {
                    const e = embarquesList.find((x) => x.id === embSelId);
                    if (!e) {
                      return (
                        <p style={{ color: '#64748b', margin: 0 }}>
                          Selecciona un embarque para ver el detalle y devolver inventario.
                        </p>
                      );
                    }
                    const total = (e.detalles || []).reduce(
                      (s, d) => s + (d.cantidad_cajas || 0),
                      0
                    );
                    return (
                      <>
                        <h4 style={{ marginTop: 0 }}>Embarque #{e.id}</h4>
                        <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
                          Fecha: <strong>{e.fecha_salida}</strong> · Cliente id:{' '}
                          <strong>{e.cliente_id}</strong>
                          {e.notas ? (
                            <>
                              <br />
                              Notas: {e.notas}
                            </>
                          ) : null}
                        </div>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: 13,
                            marginBottom: 14,
                          }}
                        >
                          <thead>
                            <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                              <th style={th}>Presentación</th>
                              <th style={th}>Talla</th>
                              <th style={th}>Mercado</th>
                              <th style={th}>Cajas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(e.detalles || []).map((d, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <td style={td}>
                                  {d.presentacion
                                    ? labelPresentacionLimon(d.presentacion) || d.presentacion
                                    : d.producto}
                                </td>
                                <td style={td}>{d.talla || '—'}</td>
                                <td style={td}>{d.mercado || '—'}</td>
                                <td style={{ ...td, fontWeight: 700 }}>{d.cantidad_cajas}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p style={{ fontSize: 13, marginBottom: 12 }}>
                          Total a devolver: <strong>{total}</strong> cajas/bins
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            eliminarEmbarqueConConfirm(
                              e.id,
                              (e.detalles || [])
                                .map(
                                  (d) =>
                                    `${d.presentacion || d.producto}${d.talla ? ' #' + d.talla : ''}: ${d.cantidad_cajas}`
                                )
                                .join('\n')
                            )
                          }
                          style={{
                            padding: '10px 16px',
                            background: '#dc2626',
                            color: 'white',
                            border: 'none',
                            borderRadius: 8,
                            fontWeight: 700,
                            cursor: busy ? 'wait' : 'pointer',
                          }}
                        >
                          Eliminar embarque y devolver inventario
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ===== EMPAQUES (detalle) ===== */}
      {vistaSeccion === 'empaques' && (
        loading ? (
          <p>Cargando empaques…</p>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
          {/* Lista */}
          <div>
            <h3 style={{ marginTop: 0 }}>Últimos empaques</h3>
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={th}>ID</th>
                    <th style={th}>Fecha</th>
                    <th style={th}>Producto</th>
                    <th style={th}>Bins / Lotes</th>
                    <th style={th}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {empaques.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16, color: '#64748b' }}>
                        No hay empaques registrados.
                      </td>
                    </tr>
                  )}
                  {empaques.map((e) => {
                    const isSel = e.id === selectedId;
                    const isAnul = Boolean(e.detalle_corrida?.anulado);
                    const lotes =
                      e.detalle_corrida?.lotes_resumen ||
                      e.lote_desverdizado ||
                      (e.bins_desverdizado_usados ? `${e.bins_desverdizado_usados} bins` : '—');
                    return (
                      <tr
                        key={e.id}
                        onClick={() => loadEmpaqueDraft(e)}
                        style={{
                          cursor: 'pointer',
                          background: isSel ? '#dcfce7' : isAnul ? '#fef2f2' : 'white',
                          opacity: isAnul ? 0.75 : 1,
                        }}
                      >
                        <td style={td}>#{e.id}</td>
                        <td style={td}>{formatFecha(e.fecha)}</td>
                        <td style={td}>{labelProducto(e.producto)}</td>
                        <td style={td}>{lotes}</td>
                        <td style={td}>{isAnul ? 'Anulado' : 'OK'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={load}
              style={{ marginTop: 12, padding: '8px 14px', cursor: 'pointer' }}
            >
              Actualizar lista
            </button>
          </div>

          {/* Detalle / acciones */}
          <div
            style={{
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {!selected ? (
              <p style={{ color: '#64748b' }}>Selecciona un empaque de la lista para editarlo.</p>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>
                  Editar empaque #{selected.id} — {labelProducto(selected.producto)}
                </h3>
                {anulado && (
                  <div style={{ marginTop: 8 }}>
                    <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 12 }}>
                      Anulado
                      {selected.detalle_corrida?.anulado_por
                        ? ` por ${selected.detalle_corrida.anulado_por}`
                        : ''}{' '}
                      — no editable
                    </p>
                    <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
                      El inventario ya se revirtió al anular. Puedes borrar este registro del
                      historial si ya no lo necesitas ver.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleBorrarAnulado(selected.id)}
                      style={{
                        padding: '12px 20px',
                        background: '#7f1d1d',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: busy ? 'wait' : 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      Borrar del historial
                    </button>
                  </div>
                )}

                {selected.producto === 'limon_amarillo' && !anulado && (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: 10,
                        marginTop: 12,
                      }}
                    >
                      <label style={editLabel}>
                        Fecha
                        <input
                          type="date"
                          value={editFecha}
                          onChange={(e) => setEditFecha(e.target.value)}
                          style={editInput}
                        />
                      </label>
                      <label style={editLabel}>
                        Empacador
                        <input
                          value={editEmpacador}
                          onChange={(e) => setEditEmpacador(e.target.value)}
                          style={editInput}
                        />
                      </label>
                      <label style={editLabel}>
                        Mercado
                        <select
                          value={editMercado}
                          onChange={(e) =>
                            setEditMercado(e.target.value as 'nacional' | 'exportacion')
                          }
                          style={editInput}
                        >
                          <option value="nacional">nacional</option>
                          <option value="exportacion">exportacion</option>
                        </select>
                      </label>
                    </div>

                    <h4 style={{ marginBottom: 8, marginTop: 18 }}>Consumos (lotes / bins)</h4>
                    <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
                      Edita, quita o agrega lotes. Al guardar se ajusta el desverdizado.
                    </p>
                    {editConsumos.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginBottom: 8,
                          alignItems: 'flex-end',
                        }}
                      >
                        <label style={editLabel}>
                          Lote
                          <input
                            list={`lotes-desv-${selected.id}`}
                            value={c.lote}
                            onChange={(e) => {
                              const next = [...editConsumos];
                              next[i] = { ...next[i], lote: e.target.value };
                              setEditConsumos(next);
                            }}
                            style={{ ...editInput, minWidth: 140 }}
                          />
                        </label>
                        <label style={editLabel}>
                          Bins
                          <input
                            type="number"
                            min={0}
                            value={c.bins}
                            onChange={(e) => {
                              const next = [...editConsumos];
                              next[i] = { ...next[i], bins: e.target.value };
                              setEditConsumos(next);
                            }}
                            style={{ ...editInput, width: 80 }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setEditConsumos(editConsumos.filter((_, j) => j !== i))}
                          style={{
                            padding: '8px 12px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                    <datalist id={`lotes-desv-${selected.id}`}>
                      {desverdizado.map((d) => (
                        <option key={d.id} value={d.lote}>
                          {d.cantidad_bins_disponibles} bins
                        </option>
                      ))}
                    </datalist>
                    <button
                      type="button"
                      onClick={() => setEditConsumos([...editConsumos, { lote: '', bins: '' }])}
                      style={{
                        padding: '8px 14px',
                        marginBottom: 16,
                        background: '#e0f2fe',
                        color: '#0c4a6e',
                        border: '1px solid #bae6fd',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      + Agregar lote
                    </button>

                    <h4 style={{ marginBottom: 8 }}>Producción (presentación / talla / cantidad)</h4>
                    {editProduccion.map((p, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginBottom: 8,
                          alignItems: 'flex-end',
                        }}
                      >
                        <label style={editLabel}>
                          Presentación
                          <select
                            value={p.presentacion}
                            onChange={(e) => {
                              const next = [...editProduccion];
                              next[i] = {
                                ...next[i],
                                presentacion: e.target.value,
                                talla: e.target.value === 'bins_jugo' ? '' : next[i].talla,
                              };
                              setEditProduccion(next);
                            }}
                            style={{ ...editInput, minWidth: 140 }}
                          >
                            <option value="">—</option>
                            {PRESENTACIONES_LIMON.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {p.presentacion !== 'bins_jugo' && (
                          <label style={editLabel}>
                            Talla
                            <select
                              value={p.talla}
                              onChange={(e) => {
                                const next = [...editProduccion];
                                next[i] = { ...next[i], talla: e.target.value };
                                setEditProduccion(next);
                              }}
                              style={editInput}
                            >
                              <option value="">—</option>
                              {TALLAS_LIMON.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label style={editLabel}>
                          Cantidad
                          <input
                            type="number"
                            min={0}
                            value={p.cantidad}
                            onChange={(e) => {
                              const next = [...editProduccion];
                              next[i] = { ...next[i], cantidad: e.target.value };
                              setEditProduccion(next);
                            }}
                            style={{ ...editInput, width: 90 }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setEditProduccion(editProduccion.filter((_, j) => j !== i))
                          }
                          style={{
                            padding: '8px 12px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setEditProduccion([
                          ...editProduccion,
                          { presentacion: 'rpc_18', talla: '140', cantidad: '' },
                        ])
                      }
                      style={{
                        padding: '8px 14px',
                        marginBottom: 16,
                        background: '#e0f2fe',
                        color: '#0c4a6e',
                        border: '1px solid #bae6fd',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      + Agregar producción
                    </button>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleGuardarEmpaque}
                        style={{
                          padding: '12px 20px',
                          background: '#15803d',
                          color: 'white',
                          border: 'none',
                          borderRadius: 6,
                          cursor: busy ? 'wait' : 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        Guardar cambios
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleAnular}
                        style={{
                          padding: '12px 20px',
                          background: '#dc2626',
                          color: 'white',
                          border: 'none',
                          borderRadius: 6,
                          cursor: busy ? 'wait' : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Anular empaque completo
                      </button>
                    </div>
                    <p style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
                      Guardar ajusta desverdizado e inventario final. Anular revierte todo el
                      registro.
                    </p>
                  </>
                )}

                {selected.producto !== 'limon_amarillo' && (
                  <p style={{ color: '#64748b', marginTop: 16, fontSize: 14 }}>
                    Edición completa por ahora solo para limón amarillo.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        )
      )}

      {/* Inventarios manuales */}
      {vistaSeccion === 'inventarios' && (
        <InventariosAdmin
          token={token}
          onChanged={() => {
            onCorregido?.();
          }}
        />
      )}

      {/* Lotes desverdizado */}
      {vistaSeccion === 'desverdizado' && !loading && (
        <div
          style={{
            marginTop: 8,
            padding: 20,
            border: '1px solid #fecaca',
            borderRadius: 12,
            background: '#fffafa',
          }}
        >
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>Desverdizado: editar o eliminar</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, maxWidth: 720 }}>
            Corrige lote, bins, fecha de corte o estado. Eliminar quita el stock de desverdizado
            (no borra el historial de recepción).
          </p>

          {editDesv && (
            <div
              style={{
                marginBottom: 16,
                padding: 16,
                background: 'white',
                border: '1px solid #86efac',
                borderRadius: 10,
              }}
            >
              <h4 style={{ marginTop: 0 }}>Editar registro #{editDesv.id}</h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 12,
                }}
              >
                <label style={editLabel}>
                  Lote
                  <input
                    value={editLote}
                    onChange={(e) => setEditLote(e.target.value)}
                    style={editInput}
                  />
                </label>
                <label style={editLabel}>
                  Bins
                  <input
                    type="number"
                    min={0}
                    value={editBins}
                    onChange={(e) => setEditBins(e.target.value)}
                    style={editInput}
                  />
                </label>
                <label style={editLabel}>
                  Fecha corte / recepción
                  <input
                    type="date"
                    value={editFechaCorte}
                    onChange={(e) => setEditFechaCorte(e.target.value)}
                    style={editInput}
                  />
                </label>
                <label style={editLabel}>
                  Salida tentativa
                  <input
                    type="date"
                    value={editFechaTent}
                    onChange={(e) => {
                      setEditFechaTent(e.target.value);
                      setEditRecalc(false);
                    }}
                    disabled={editRecalc}
                    style={{ ...editInput, opacity: editRecalc ? 0.6 : 1 }}
                  />
                </label>
                <label style={editLabel}>
                  Estado
                  <select
                    value={editEstado}
                    onChange={(e) => setEditEstado(e.target.value)}
                    style={editInput}
                  >
                    <option value="en_desverdizado">en_desverdizado</option>
                    <option value="listo_empaque">listo_empaque</option>
                    <option value="empaquetado">empaquetado</option>
                  </select>
                </label>
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 12,
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={editRecalc}
                  onChange={(e) => setEditRecalc(e.target.checked)}
                />
                Recalcular salida tentativa = corte + {DIAS_DESVERDIZADO} días
              </label>
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGuardarDesverdizado}
                  style={{
                    padding: '10px 18px',
                    background: '#15803d',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Guardar cambios
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelEditDesverdizado}
                  style={{
                    padding: '10px 18px',
                    background: '#64748b',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {desverdizado.length === 0 ? (
            <p style={{ color: '#64748b' }}>No hay lotes con bins en desverdizado.</p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#fef2f2', textAlign: 'left' }}>
                    <th style={th}>ID</th>
                    <th style={th}>Lote</th>
                    <th style={th}>Bins</th>
                    <th style={th}>Corte</th>
                    <th style={th}>Salida tent.</th>
                    <th style={th}>Estado</th>
                    <th style={th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {desverdizado.map((d) => (
                    <tr
                      key={d.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: editDesv?.id === d.id ? '#dcfce7' : 'white',
                      }}
                    >
                      <td style={td}>#{d.id}</td>
                      <td style={td}>
                        <strong>{d.lote}</strong>
                      </td>
                      <td style={td}>{d.cantidad_bins_disponibles}</td>
                      <td style={td}>{formatFecha(d.fecha_recepcion || '')}</td>
                      <td style={td}>{formatFecha(d.fecha_tentativa_salida || '')}</td>
                      <td style={td}>{d.estado || '—'}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openEditDesverdizado(d)}
                            style={{
                              padding: '6px 12px',
                              background: '#0369a1',
                              color: 'white',
                              border: 'none',
                              borderRadius: 6,
                              cursor: busy ? 'wait' : 'pointer',
                              fontWeight: 600,
                              fontSize: 13,
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleEliminarDesverdizado(d, true)}
                            title="Solo este registro (esta fecha de corte)"
                            style={{
                              padding: '6px 12px',
                              background: '#ea580c',
                              color: 'white',
                              border: 'none',
                              borderRadius: 6,
                              cursor: busy ? 'wait' : 'pointer',
                              fontWeight: 600,
                              fontSize: 13,
                            }}
                          >
                            Borrar este
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleEliminarDesverdizado(d, false)}
                            title="Todas las recepciones de este nombre de lote"
                            style={{
                              padding: '6px 12px',
                              background: '#dc2626',
                              color: 'white',
                              border: 'none',
                              borderRadius: 6,
                              cursor: busy ? 'wait' : 'pointer',
                              fontWeight: 600,
                              fontSize: 13,
                            }}
                          >
                            Borrar lote
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const th: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 13,
};

const td: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
};

const editLabel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 13,
  gap: 4,
};

const editInput: CSSProperties = {
  padding: 8,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: 'white',
  color: '#0f172a',
};
