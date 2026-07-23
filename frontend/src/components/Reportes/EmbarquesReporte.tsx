import { useMemo, useState, type CSSProperties } from 'react';
import type {
  ClienteEmbarquesResumenApi,
  EmbarqueReporteItemApi,
  EmbarquesReporteApi,
} from '../../lib/api';
import { labelPresentacionLimon } from '../../lib/constants';

interface Props {
  data: EmbarquesReporteApi | null;
  loading?: boolean;
  onRefresh?: () => void;
}

const card: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 140,
};

const th: CSSProperties = { padding: '10px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '10px 8px', verticalAlign: 'top' };

function fmtKg(n: number | undefined) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function labelPres(p: string | null | undefined) {
  if (!p) return '—';
  return labelPresentacionLimon(p) || p;
}

type DetalleParr = {
  presentacion?: string | null;
  cantidad_cajas?: number;
  cajas_por_parrilla?: number | null;
};

/** Divisor de parrilla: usa cajas_por_parrilla del manifiesto si existe */
function divisorParrilla(d: DetalleParr): number {
  const cpp = d.cajas_por_parrilla;
  if (cpp != null && cpp > 0) return cpp;
  const p = (d.presentacion || '').trim();
  if (p === 'bins_jugo') return 1;
  if (p === 'caja_40lbs') return 63;
  if (p === 'rpc_12' || p === 'rpc_18') return 45; // default RPC6423
  return 0;
}

/** Nunca decimales: N parrillas + M cajas */
function formatParrillasConDivisor(cajasIn: number, div: number): string {
  const cajas = Math.round(cajasIn || 0);
  if (div <= 0) return cajas === 0 ? '0' : `${cajas} u.`;
  if (div === 1) {
    return cajas === 1 ? '1 parrilla' : `${cajas} parrillas`;
  }
  const enteras = Math.floor(cajas / div);
  const sueltas = cajas % div;
  if (enteras > 0 && sueltas > 0) {
    return `${enteras} parrilla${enteras !== 1 ? 's' : ''} + ${sueltas} caja${sueltas !== 1 ? 's' : ''}`;
  }
  if (enteras > 0) return `${enteras} parrilla${enteras !== 1 ? 's' : ''}`;
  if (sueltas > 0) return `${sueltas} caja${sueltas !== 1 ? 's' : ''}`;
  return '0';
}

function formatParrillasLinea(
  presentacion: string | null | undefined,
  cantidad: number,
  cajasPorParrilla?: number | null
): string {
  const div = divisorParrilla({
    presentacion,
    cantidad_cajas: cantidad,
    cajas_por_parrilla: cajasPorParrilla,
  });
  return formatParrillasConDivisor(cantidad, div);
}

/**
 * Control de parrillas unificado:
 * - 1ra = RPC (40 o 45) + cartón (63) → solo "parrillas" (enteras) + cajas sueltas totales
 * - jugo = bins (1 = 1 parrilla)
 * No distingue 6423/6425 ni RPC vs cartón en el texto.
 */
function resumirParrillas1raJugo(detalles: DetalleParr[] | undefined): {
  parr1ra: number;
  cajasSueltas1ra: number;
  parrJugo: number;
  label: string;
} {
  let parr1ra = 0;
  let cajasSueltas1ra = 0;
  let parrJugo = 0;
  for (const d of detalles || []) {
    const c = Math.round(d.cantidad_cajas || 0);
    if (c <= 0) continue;
    const p = (d.presentacion || '').trim();
    if (p === 'bins_jugo') {
      parrJugo += c;
      continue;
    }
    const div = divisorParrilla(d);
    if (div <= 0) continue;
    parr1ra += Math.floor(c / div);
    cajasSueltas1ra += c % div;
  }
  const parts: string[] = [];
  if (parr1ra > 0 || cajasSueltas1ra > 0) {
    if (parr1ra > 0 && cajasSueltas1ra > 0) {
      parts.push(
        `${parr1ra} parrilla${parr1ra !== 1 ? 's' : ''} 1ra + ${cajasSueltas1ra} caja${cajasSueltas1ra !== 1 ? 's' : ''}`
      );
    } else if (parr1ra > 0) {
      parts.push(`${parr1ra} parrilla${parr1ra !== 1 ? 's' : ''} 1ra`);
    } else {
      parts.push(`${cajasSueltas1ra} caja${cajasSueltas1ra !== 1 ? 's' : ''} 1ra`);
    }
  }
  if (parrJugo > 0) {
    parts.push(`${parrJugo} parrilla${parrJugo !== 1 ? 's' : ''} jugo`);
  }
  return {
    parr1ra,
    cajasSueltas1ra,
    parrJugo,
    label: parts.length ? parts.join(' · ') : '0',
  };
}

function parrillasDeEmbarque(e: EmbarqueReporteItemApi): string {
  return resumirParrillas1raJugo(e.detalles).label;
}

function parrillasDeCliente(c: ClienteEmbarquesResumenApi): string {
  const dets = (c.embarques || []).flatMap((e) => e.detalles || []);
  return resumirParrillas1raJugo(dets).label;
}

function enterasGlobal(data: EmbarquesReporteApi): number {
  const dets = (data.embarques || []).flatMap((e) => e.detalles || []);
  const r = resumirParrillas1raJugo(dets);
  return r.parr1ra + r.parrJugo;
}

function labelGlobalParrillas(data: EmbarquesReporteApi): string {
  const dets = (data.embarques || []).flatMap((e) => e.detalles || []);
  return resumirParrillas1raJugo(dets).label;
}

export default function EmbarquesReporte({ data, loading, onRefresh }: Props) {
  const [clienteId, setClienteId] = useState<number | 'todos'>('todos');
  const [embarqueSel, setEmbarqueSel] = useState<EmbarqueReporteItemApi | null>(null);

  const clientes = data?.por_cliente || [];
  const embarquesFiltrados = useMemo(() => {
    if (!data) return [];
    if (clienteId === 'todos') return data.embarques || [];
    const c = clientes.find((x) => x.cliente_id === clienteId);
    return c?.embarques || [];
  }, [data, clienteId, clientes]);

  if (loading) {
    return <p style={{ color: '#64748b' }}>Cargando reporte de embarques…</p>;
  }

  if (!data) {
    return (
      <div>
        <p style={{ color: '#64748b' }}>No se pudo cargar el reporte de embarques.</p>
        {onRefresh && (
          <button type="button" onClick={onRefresh} style={{ padding: '8px 14px' }}>
            Reintentar
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Reporte de embarques</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b', maxWidth: 720 }}>
            Historial por cliente: cuántos embarques se han enviado, parrillas (RPC 45 · cartón 63 ·
            jugo 1) y detalle al hacer clic.
          </p>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} style={{ padding: '8px 14px', height: 36 }}>
            Actualizar
          </button>
        )}
      </div>

      {/* Totales globales */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, marginBottom: 20 }}>
        <div style={{ ...card, background: '#e0e7ff' }}>
          <div style={{ fontSize: 12, color: '#3730a3', fontWeight: 600 }}>Embarques</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{data.total_embarques}</div>
        </div>
        <div style={{ ...card, background: '#dcfce7' }}>
          <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>Clientes</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{data.num_clientes}</div>
        </div>
        <div style={{ ...card, background: '#e0f2fe', minWidth: 200 }}>
          <div style={{ fontSize: 12, color: '#075985', fontWeight: 600 }}>Parrillas totales</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{enterasGlobal(data)}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {labelGlobalParrillas(data)}
          </div>
        </div>
        <div style={{ ...card, background: '#fef9c3' }}>
          <div style={{ fontSize: 12, color: '#854d0e', fontWeight: 600 }}>Kg aprox.</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{fmtKg(data.total_kg_aprox)}</div>
        </div>
      </div>

      {/* Resumen por cliente */}
      <h4 style={{ margin: '8px 0' }}>Resumen por cliente</h4>
      {clientes.length === 0 ? (
        <p style={{ color: '#64748b' }}>
          Aún no hay embarques registrados. Cuando envíes desde la pestaña Embarques, aparecerán
          aquí.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                <th style={th}>Cliente</th>
                <th style={th}># Embarques</th>
                <th style={th}>Parrillas</th>
                <th style={th}>Kg aprox.</th>
                <th style={th}>Último embarque</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c: ClienteEmbarquesResumenApi) => {
                const activo = clienteId === c.cliente_id;
                return (
                  <tr
                    key={c.cliente_id}
                    style={{
                      borderBottom: '1px solid #e2e8f0',
                      background: activo ? '#eef2ff' : undefined,
                    }}
                  >
                    <td style={td}>
                      <strong>{c.cliente_nombre}</strong>
                    </td>
                    <td style={{ ...td, fontWeight: 700, fontSize: 16 }}>{c.num_embarques}</td>
                    <td style={{ ...td, fontWeight: 700, maxWidth: 280 }}>
                      {parrillasDeCliente(c)}
                    </td>
                    <td style={td}>{fmtKg(c.total_kg_aprox)}</td>
                    <td style={td}>{c.ultima_fecha || '—'}</td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() =>
                          setClienteId(activo ? 'todos' : c.cliente_id)
                        }
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: 'none',
                          cursor: 'pointer',
                          background: activo ? '#4338ca' : '#e0e7ff',
                          color: activo ? 'white' : '#3730a3',
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {activo ? 'Ver todos' : 'Ver historial'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lista de embarques */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>
          Historial de embarques
          {clienteId !== 'todos' && (
            <span style={{ fontWeight: 500, color: '#64748b', fontSize: 13 }}>
              {' '}
              · filtrado por cliente
            </span>
          )}
        </h4>
        {clienteId !== 'todos' && (
          <button
            type="button"
            onClick={() => setClienteId('todos')}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid #c7d2fe',
              background: '#eef2ff',
              color: '#3730a3',
              cursor: 'pointer',
            }}
          >
            Quitar filtro
          </button>
        )}
      </div>

      {embarquesFiltrados.length === 0 ? (
        <p style={{ color: '#64748b' }}>—</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Fecha</th>
                <th style={th}>Cliente</th>
                <th style={th}>Parrillas</th>
                <th style={th}>Kg aprox.</th>
                <th style={th}>Líneas</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {embarquesFiltrados.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setEmbarqueSel(e)}
                  style={{
                    borderBottom: '1px solid #e2e8f0',
                    cursor: 'pointer',
                    background: embarqueSel?.id === e.id ? '#f5f3ff' : undefined,
                  }}
                  title="Clic para ver detalle"
                >
                  <td style={td}>
                    <strong>{e.id}</strong>
                  </td>
                  <td style={td}>{e.fecha_salida}</td>
                  <td style={td}>{e.cliente_nombre}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{parrillasDeEmbarque(e)}</td>
                  <td style={td}>{fmtKg(e.total_kg_aprox)}</td>
                  <td style={td}>{e.num_lineas ?? e.detalles?.length ?? 0}</td>
                  <td style={td}>
                    <span style={{ color: '#6366f1', fontWeight: 600, fontSize: 12 }}>
                      Ver detalle →
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel / modal de detalle */}
      {embarqueSel && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setEmbarqueSel(null)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              maxWidth: 720,
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 20,
              boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 4px' }}>Embarque #{embarqueSel.id}</h3>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  {embarqueSel.fecha_salida} · {embarqueSel.cliente_nombre}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEmbarqueSel(null)}
                style={{
                  border: 'none',
                  background: '#f1f5f9',
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Cerrar
              </button>
            </div>

            {embarqueSel.notas && (
              <p
                style={{
                  marginTop: 12,
                  padding: 10,
                  background: '#f8fafc',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <strong>Notas:</strong> {embarqueSel.notas}
              </p>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <div style={card}>
                <div style={{ fontSize: 12, color: '#64748b' }}>Parrillas</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#14532d' }}>
                  {parrillasDeEmbarque(embarqueSel)}
                </div>
              </div>
              <div style={card}>
                <div style={{ fontSize: 12, color: '#64748b' }}>Kg aprox.</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {fmtKg(embarqueSel.total_kg_aprox)}
                </div>
              </div>
              <div style={card}>
                <div style={{ fontSize: 12, color: '#64748b' }}>Líneas</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {embarqueSel.detalles?.length || 0}
                </div>
              </div>
            </div>

            <h4 style={{ marginTop: 20, marginBottom: 8 }}>Detalle embarcado</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <th style={th}>Presentación</th>
                  <th style={th}>Talla</th>
                  <th style={th}>Calidad</th>
                  <th style={th}>Parrillas</th>
                  <th style={th}>Kg</th>
                  <th style={th}>Lotes de origen</th>
                </tr>
              </thead>
              <tbody>
                {(embarqueSel.detalles || []).map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={td}>{labelPres(d.presentacion)}</td>
                    <td style={td}>{d.talla || '—'}</td>
                    <td style={td}>{d.calidad || '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {d.presentacion === 'bins_jugo'
                        ? formatParrillasLinea(d.presentacion, d.cantidad_cajas, 1)
                        : d.presentacion === 'rpc_12' || d.presentacion === 'rpc_18'
                          ? `RPC ${formatParrillasLinea(d.presentacion, d.cantidad_cajas, d.cajas_por_parrilla)}`
                          : formatParrillasLinea(
                              d.presentacion,
                              d.cantidad_cajas,
                              d.cajas_por_parrilla
                            )}
                    </td>
                    <td style={td}>{fmtKg(d.kg_aprox)}</td>
                    <td style={td}>
                      {(d.lotes || []).length === 0 ? (
                        <span style={{ color: '#94a3b8', fontSize: 12 }}>
                          Sin lote en empaque (referencia)
                        </span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                          {(d.lotes || []).map((l, j) => (
                            <li key={j}>
                              <strong>{l.lote}</strong>
                              {l.fecha_empaque ? ` · emp. ${l.fecha_empaque}` : ''}
                              {l.empaque_id != null ? ` · #${l.empaque_id}` : ''}
                              {l.cantidad_producida
                                ? ` · prod. ${l.cantidad_producida} cajas`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
              Los lotes se infieren del historial de empaque (misma presentación y talla). El
              embarque descuenta stock por presentación/talla; no guarda el lote en la línea de
              embarque.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
