import { useState, useEffect, type CSSProperties } from 'react';
import {
  getEmpaquesAdmin,
  agregarConsumoEmpaque,
  anularEmpaque,
  getApiBaseUrl,
} from '../../lib/api';
import type { EmpaqueRecord } from '../../types';

interface CorreccionesProps {
  token: string;
  onCorregido?: () => void;
}

function formatFecha(fecha: string) {
  if (!fecha) return '—';
  const date = new Date(fecha.includes('T') ? fecha : `${fecha}T12:00:00`);
  if (isNaN(date.getTime())) return fecha;
  const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const d = String(date.getDate()).padStart(2, '0');
  return `${d} ${meses[date.getMonth()]} ${date.getFullYear()}`;
}

function labelProducto(p: string) {
  if (p === 'limon_amarillo') return 'Limón amarillo';
  if (p === 'uva') return 'Uva';
  return p;
}

export default function Correcciones({ token, onCorregido }: CorreccionesProps) {
  const [empaques, setEmpaques] = useState<EmpaqueRecord[]>([]);
  const [desverdizado, setDesverdizado] = useState<
    Array<{ lote: string; cantidad_bins_disponibles: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lote, setLote] = useState('');
  const [bins, setBins] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const base = getApiBaseUrl().replace(/\/$/, '');
      const [list, desv] = await Promise.all([
        getEmpaquesAdmin(token),
        fetch(`${base}/api/recepcion/desverdizado`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
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
        Usa esta pantalla cuando un empaque de limón quedó mal: te faltó un lote, o hay que anular
        todo el registro. Los cambios actualizan desverdizado e inventario final automáticamente.
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
                              <option key={d.lote} value={d.lote}>
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
