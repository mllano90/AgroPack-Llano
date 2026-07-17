import { useState, useEffect, type CSSProperties } from 'react';
import {
  getEmpaquesAdmin,
  agregarConsumoEmpaque,
  anularEmpaque,
  getDesverdizadoAdmin,
  eliminarDesverdizado,
  editarDesverdizado,
  type DesverdizadoAdminItem,
} from '../../lib/api';
import { DIAS_DESVERDIZADO } from '../../lib/constants';
import { formatFechaCorta, toInputDate } from '../../lib/dates';
import type { EmpaqueRecord } from '../../types';

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
  const [lote, setLote] = useState('');
  const [bins, setBins] = useState('');
  const [busy, setBusy] = useState(false);

  // Edición desverdizado
  const [editDesv, setEditDesv] = useState<DesverdizadoAdminItem | null>(null);
  const [editLote, setEditLote] = useState('');
  const [editBins, setEditBins] = useState('');
  const [editFechaCorte, setEditFechaCorte] = useState('');
  const [editFechaTent, setEditFechaTent] = useState('');
  const [editEstado, setEditEstado] = useState('en_desverdizado');
  const [editRecalc, setEditRecalc] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [list, desv] = await Promise.all([
        getEmpaquesAdmin(token),
        getDesverdizadoAdmin(token).catch(() => [] as DesverdizadoAdminItem[]),
      ]);
      setEmpaques(list);
      setDesverdizado(Array.isArray(desv) ? desv : []);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : err?.response?.status === 403
            ? 'Solo administradores pueden ver correcciones.'
            : 'Error cargando empaques'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const selected = empaques.find((e) => e.id === selectedId) || null;
  const anulado = Boolean(selected?.detalle_corrida?.anulado);

  const handleAgregarConsumo = async () => {
    if (!selectedId) return alert('Selecciona un empaque');
    if (!lote.trim()) return alert('Indica el lote');
    const n = parseInt(bins, 10);
    if (!n || n <= 0) return alert('Bins debe ser un número mayor a 0');

    if (
      !confirm(
        `¿Descontar ${n} bins del lote "${lote.trim()}" del desverdizado y agregarlos al empaque #${selectedId}?`
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      await agregarConsumoEmpaque(token, selectedId, lote.trim(), n);
      setOkMsg(`Consumo agregado: ${n} bins de lote ${lote.trim()} al empaque #${selectedId}`);
      setLote('');
      setBins('');
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo agregar el consumo');
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
      const res = await anularEmpaque(token, selectedId);
      setOkMsg(res.message || `Empaque #${selectedId} anulado`);
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo anular el empaque');
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
      if (lote === d.lote) {
        setLote('');
        setBins('');
      }
      await load();
      onCorregido?.();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo eliminar el lote de desverdizado');
    } finally {
      setBusy(false);
    }
  };

  const consumos =
    selected?.detalle_corrida?.consumos ||
    (selected?.lote_desverdizado
      ? [{ lote: selected.lote_desverdizado, bins: selected.bins_desverdizado_usados || 0 }]
      : []);
  const produccion = selected?.detalle_corrida?.produccion || [];

  return (
    <div>
      <h2 style={{ marginBottom: 8 }}>Correcciones (solo admin)</h2>
      <p style={{ color: '#64748b', marginTop: 0, maxWidth: 720 }}>
        Corrige empaques mal registrados (agregar lote olvidado / anular) o elimina lotes de
        desverdizado dados de alta por error. Los cambios actualizan inventario automáticamente.
      </p>

      {error && (
        <p style={{ color: '#dc2626', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{error}</p>
      )}
      {okMsg && (
        <p style={{ color: '#15803d', background: '#f0fdf4', padding: 12, borderRadius: 8 }}>{okMsg}</p>
      )}

      {loading ? (
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
                        onClick={() => {
                          setSelectedId(e.id);
                          setOkMsg('');
                          setError('');
                        }}
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
              <p style={{ color: '#64748b' }}>Selecciona un empaque de la lista para corregirlo.</p>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>
                  Empaque #{selected.id} — {labelProducto(selected.producto)}
                </h3>
                <p style={{ margin: '4px 0', fontSize: 14 }}>
                  <strong>Fecha:</strong> {formatFecha(selected.fecha)} · <strong>Empacador:</strong>{' '}
                  {selected.numero_empacador || '—'} · <strong>Mercado:</strong> {selected.mercado}
                </p>
                {anulado && (
                  <p style={{ color: '#b91c1c', fontWeight: 600 }}>
                    Anulado
                    {selected.detalle_corrida?.anulado_por
                      ? ` por ${selected.detalle_corrida.anulado_por}`
                      : ''}
                  </p>
                )}

                <div style={{ marginTop: 16 }}>
                  <strong>Consumos de desverdizado</strong>
                  {consumos.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: 14 }}>Sin consumos registrados.</p>
                  ) : (
                    <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                      {consumos.map((c, i) => (
                        <li key={i}>
                          Lote <strong>{c.lote}</strong>: {c.bins} bins
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {produccion.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong>Producción</strong>
                    <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                      {produccion.map((p, i) => (
                        <li key={i}>
                          {p.presentacion}
                          {p.talla ? ` talla ${p.talla}` : ''}: {p.cantidad}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selected.producto === 'limon_amarillo' && !anulado && (
                  <>
                    <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />
                    <h4 style={{ marginBottom: 8 }}>Agregar lote olvidado</h4>
                    <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
                      Descuenta bins del desverdizado y los asocia a este empaque (no cambia la
                      producción ya registrada).
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
                        Lote
                        <select
                          value={lote}
                          onChange={(e) => setLote(e.target.value)}
                          style={{ padding: 8, minWidth: 160, marginTop: 4 }}
                        >
                          <option value="">— seleccionar o escribir —</option>
                          {desverdizado
                            .filter((d) => (d.cantidad_bins_disponibles || 0) > 0)
                            .map((d) => (
                              <option key={d.id} value={d.lote}>
                                {d.lote} ({d.cantidad_bins_disponibles} bins)
                              </option>
                            ))}
                        </select>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
                        Lote (manual)
                        <input
                          value={lote}
                          onChange={(e) => setLote(e.target.value)}
                          placeholder="ej. L-001"
                          style={{ padding: 8, minWidth: 120, marginTop: 4 }}
                        />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
                        Bins
                        <input
                          type="number"
                          min={1}
                          value={bins}
                          onChange={(e) => setBins(e.target.value)}
                          style={{ padding: 8, width: 90, marginTop: 4 }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleAgregarConsumo}
                        style={{
                          padding: '10px 16px',
                          background: '#15803d',
                          color: 'white',
                          border: 'none',
                          borderRadius: 6,
                          cursor: busy ? 'wait' : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Agregar consumo
                      </button>
                    </div>

                    <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />
                    <h4 style={{ marginBottom: 8, color: '#b91c1c' }}>Anular empaque completo</h4>
                    <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
                      Devuelve todos los bins a desverdizado y resta la producción del inventario
                      final. Úsalo si el empaque no debió registrarse.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleAnular}
                      style={{
                        padding: '10px 16px',
                        background: '#dc2626',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: busy ? 'wait' : 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Anular empaque
                    </button>
                  </>
                )}

                {selected.producto !== 'limon_amarillo' && (
                  <p style={{ color: '#64748b', marginTop: 16, fontSize: 14 }}>
                    Correcciones automáticas por ahora solo para limón amarillo. Uva: contactar si
                    se necesita.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Lotes desverdizado */}
      {!loading && (
        <div
          style={{
            marginTop: 32,
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
