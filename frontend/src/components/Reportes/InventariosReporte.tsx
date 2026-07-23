import { useState } from 'react';
import type { DashboardData, InventarioCampoItem, InventarioFinalItem } from '../../types';
import type { ProyeccionInventarioApi } from '../../lib/api';
import { formatFechaCorta } from '../../lib/dates';
import { DIAS_DESVERDIZADO, KG_POR_PRESENTACION } from '../../lib/constants';

interface Props {
  data: DashboardData | null;
  proyeccion?: ProyeccionInventarioApi | null;
  loading?: boolean;
  onRefresh?: () => void;
}

/** Uva: parrillas de 90 cajas (igual que landing Inventarios) */
const calcularParrillasUva = (cajas: number) => {
  const parrillas = Math.floor(cajas / 90);
  const sueltas = cajas % 90;
  return { parrillas, sueltas };
};

/** Limón: RPC=45, cartón=63, jugo=1 bin = 1 parrilla */
function formatParrillasLimon(
  presentacion: string | null | undefined,
  cantidad: number
): string {
  const cajas = Math.round(cantidad || 0);
  const p = (presentacion || '').trim();
  if (p === 'bins_jugo') {
    return cajas === 1 ? '1 parrilla' : `${cajas} parrillas`;
  }
  if (p === 'rpc_granel') {
    return cajas === 0 ? '0' : `${cajas} RPC`;
  }
  const div = p === 'rpc_12' || p === 'rpc_18' ? 45 : p === 'caja_40lbs' ? 63 : 0;
  if (!div) return cajas === 0 ? '0' : `${cajas} u.`;
  const enteras = Math.floor(cajas / div);
  const sueltas = cajas % div;
  if (enteras > 0 && sueltas > 0) {
    return `${enteras} parrilla${enteras !== 1 ? 's' : ''} + ${sueltas} caja${sueltas !== 1 ? 's' : ''}`;
  }
  if (enteras > 0) return `${enteras} parrilla${enteras !== 1 ? 's' : ''}`;
  if (sueltas > 0) return `${sueltas} caja${sueltas !== 1 ? 's' : ''}`;
  return '0';
}

/** Suma cajas de varias líneas y formatea como parrillas (misma presentación). */
function sumFormatParrillas(
  items: InventarioFinalItem[],
  presentaciones: string | string[]
): string {
  const set = new Set(Array.isArray(presentaciones) ? presentaciones : [presentaciones]);
  const total = items
    .filter((i) => set.has(i.presentacion || ''))
    .reduce((s, i) => s + (i.cantidad_stock || 0), 0);
  const pres = Array.isArray(presentaciones) ? presentaciones[0] : presentaciones;
  // RPC 12 y 18 comparten divisor 45
  const labelPres =
    set.has('rpc_12') || set.has('rpc_18')
      ? 'rpc_18'
      : set.has('caja_40lbs')
        ? 'caja_40lbs'
        : set.has('bins_jugo')
          ? 'bins_jugo'
          : set.has('rpc_granel')
            ? 'rpc_granel'
            : pres;
  return formatParrillasLimon(labelPres, total);
}

/** Aprox. parrillas 1ra desde kg (mezcla RPC/cartón ≈ 18 kg/caja, ~50 cajas/parr media) */
function aproxParrillas1ra(kg: number): string {
  // Preferir unidades_totales si se pasa; fallback por kg
  const kgCaja = 18;
  const cajas = kg / kgCaja;
  // Media ponderada práctica: ~50 cajas/parr (entre 40-45 RPC y 63 cartón)
  const parr = cajas / 50;
  const enteras = Math.floor(parr);
  const sueltas = Math.round((parr - enteras) * 50);
  if (enteras <= 0 && sueltas <= 0) return '≈ 0 parrillas';
  if (enteras > 0 && sueltas > 0) {
    return `≈ ${enteras} parrilla${enteras !== 1 ? 's' : ''} + ${sueltas} cajas`;
  }
  if (enteras > 0) return `≈ ${enteras} parrilla${enteras !== 1 ? 's' : ''}`;
  return `≈ ${sueltas} cajas`;
}

function aproxBins2da(kg: number): string {
  const bins = kg / (KG_POR_PRESENTACION.bins_jugo || 900);
  const n = Math.round(bins * 10) / 10;
  if (n <= 0) return '≈ 0 bins';
  if (Number.isInteger(n)) return `≈ ${n} bin${n !== 1 ? 's' : ''} (parrillas jugo)`;
  return `≈ ${n} bins (parrillas jugo)`;
}

/** Suma parrillas enteras desde unidades proyectadas (más preciso que kg) */
function parrillasDesdeUnidades(
  unidades: { presentacion: string; cantidad: number; parrillas_label?: string }[]
): { parr1ra: number; label1ra: string; binsJugo: number } {
  let cajasRpc = 0;
  let cajasCarton = 0;
  let binsJugo = 0;
  for (const u of unidades) {
    const c = Math.round(u.cantidad || 0);
    if (u.presentacion === 'bins_jugo') binsJugo += c;
    else if (u.presentacion === 'rpc_12' || u.presentacion === 'rpc_18') cajasRpc += c;
    else if (u.presentacion === 'caja_40lbs') cajasCarton += c;
  }
  const pRpc = Math.floor(cajasRpc / 45);
  const sRpc = cajasRpc % 45;
  const pCart = Math.floor(cajasCarton / 63);
  const sCart = cajasCarton % 63;
  const parr1ra = pRpc + pCart;
  const sueltas = sRpc + sCart;
  let label1ra = '';
  if (parr1ra > 0 && sueltas > 0) label1ra = `≈ ${parr1ra} parrillas 1ra + ${sueltas} cajas`;
  else if (parr1ra > 0) label1ra = `≈ ${parr1ra} parrilla${parr1ra !== 1 ? 's' : ''} 1ra`;
  else if (sueltas > 0) label1ra = `≈ ${sueltas} cajas 1ra`;
  else label1ra = '≈ 0 parrillas 1ra';
  return { parr1ra, label1ra, binsJugo };
}

export default function InventariosReporte({
  data,
  proyeccion = null,
  loading,
  onRefresh,
}: Props) {
  const [productTab, setProductTab] = useState<'uva' | 'limon'>('limon');

  if (loading) {
    return <p style={{ color: '#64748b' }}>Cargando inventarios…</p>;
  }
  if (!data) {
    return (
      <div>
        <p style={{ color: '#64748b' }}>No se pudo cargar inventarios.</p>
        {onRefresh && (
          <button type="button" onClick={onRefresh} style={{ padding: '8px 14px' }}>
            Reintentar
          </button>
        )}
      </div>
    );
  }

  const inventarioCampo: InventarioCampoItem[] = data.inventario_campo || [];
  const inventarioCarton: InventarioFinalItem[] = data.inventario_final || [];
  const desverdizado = data.desverdizado || [];

  const isUva = productTab === 'uva';
  const isLimon = productTab === 'limon';

  const uvaFinalItems = inventarioCarton.filter(
    (i) => !i.presentacion && (i.producto === 'uva' || !i.producto)
  );
  const limonFinalItems = inventarioCarton.filter(
    (i) => i.producto === 'limon_amarillo' || !!i.presentacion
  );
  const visibleDesverdizado = (desverdizado || [])
    .filter((d) => d.cantidad_bins_disponibles > 0)
    .slice()
    .sort((a, b) => {
      const fa = String(a.fecha_recepcion || '');
      const fb = String(b.fecha_recepcion || '');
      if (fa !== fb) return fa.localeCompare(fb);
      return String(a.lote || '').localeCompare(String(b.lote || ''));
    });
  const visibleUvaFinal = uvaFinalItems.filter((i) => (i.cantidad_stock || 0) > 0);
  const visibleLimonFinal = limonFinalItems.filter((i) => (i.cantidad_stock || 0) > 0);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0 }}>📦 Inventarios</h3>
        {onRefresh && (
          <button type="button" onClick={onRefresh} style={{ padding: '8px 14px' }}>
            Actualizar
          </button>
        )}
      </div>

      {/* Tabs — igual que landing */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
        <button
          type="button"
          onClick={() => setProductTab('uva')}
          style={{
            padding: '8px 16px',
            background: isUva ? '#15803d' : '#f1f5f9',
            color: isUva ? 'white' : '#334155',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Uva
        </button>
        <button
          type="button"
          onClick={() => setProductTab('limon')}
          style={{
            padding: '8px 16px',
            background: isLimon ? '#15803d' : '#f1f5f9',
            color: isLimon ? 'white' : '#334155',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Limón Amarillo
        </button>
      </div>

      {/* Resumen rápido */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', flexWrap: 'wrap' }}>
        {isUva && (
          <>
            <div style={{ background: '#f1f5f9', padding: '12px 20px', borderRadius: '8px' }}>
              <strong>Total Campo:</strong>{' '}
              {inventarioCampo.reduce((sum, i) => sum + i.cantidad, 0)} cajas
            </div>
            <div style={{ background: '#f1f5f9', padding: '12px 20px', borderRadius: '8px' }}>
              <strong>Total Final Uva:</strong>{' '}
              {visibleUvaFinal.reduce((sum, i) => sum + (i.cantidad_stock || 0), 0)} cajas
            </div>
          </>
        )}
        {isLimon && (
          <>
            <div style={{ background: '#e0f2fe', padding: '12px 20px', borderRadius: '8px' }}>
              <strong>Bins en Desverdizado:</strong>{' '}
              {visibleDesverdizado.reduce(
                (sum, d) => sum + (d.cantidad_bins_disponibles || 0),
                0
              )}{' '}
              bins
            </div>
            <div style={{ background: '#fefce8', padding: '12px 20px', borderRadius: '8px' }}>
              <strong>Total Limón:</strong> Granel:{' '}
              {sumFormatParrillas(visibleLimonFinal, 'rpc_granel')} | RPC:{' '}
              {sumFormatParrillas(visibleLimonFinal, ['rpc_12', 'rpc_18'])} | Cartón:{' '}
              {sumFormatParrillas(visibleLimonFinal, 'caja_40lbs')} | Bins jugo:{' '}
              {sumFormatParrillas(visibleLimonFinal, 'bins_jugo')}
            </div>
          </>
        )}
      </div>

      {/* === INVENTARIO FINAL UVA === */}
      {isUva && visibleUvaFinal.length > 0 && (
        <>
          <h3>Inventario Final (Cajas de Cartón) — por Variedad y Mercado</h3>
          {Object.values(
            visibleUvaFinal.reduce<Record<string, InventarioFinalItem[]>>((acc, item) => {
              const key = item.variedad || 'sin_variedad';
              if (!acc[key]) acc[key] = [];
              acc[key].push(item);
              return acc;
            }, {})
          ).map((grupo, idx: number) => {
            const variedad = grupo[0].variedad || 'sin variedad';
            const totalVariedad = grupo.reduce((sum, i) => sum + i.cantidad_stock, 0);
            const totalParrillas = Math.floor(totalVariedad / 90);
            const totalSueltas = totalVariedad % 90;

            return (
              <div
                key={idx}
                style={{
                  marginBottom: '18px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px',
                  }}
                >
                  <strong style={{ fontSize: '15px' }}>{variedad}</strong>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>
                    Total: <strong>{totalVariedad}</strong> cajas ({totalParrillas} parrillas +{' '}
                    {totalSueltas} sueltas)
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {['nacional', 'exportacion'].map((mkt) => {
                    const itemsDelMercado = grupo.filter((i) => i.mercado === mkt);
                    return (
                      <div
                        key={mkt}
                        style={{
                          padding: '10px 12px',
                          background: mkt === 'exportacion' ? '#dbeafe' : '#dcfce7',
                          borderRadius: '6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: mkt === 'exportacion' ? '#1e40af' : '#166534',
                            marginBottom: '4px',
                          }}
                        >
                          {mkt.toUpperCase()}
                        </div>
                        {itemsDelMercado.length > 0 ? (
                          itemsDelMercado.map((item, i3: number) => {
                            const { parrillas, sueltas } = calcularParrillasUva(
                              item.cantidad_stock
                            );
                            return (
                              <div key={i3} style={{ fontSize: '13px', marginBottom: '2px' }}>
                                {item.tipo_cultivo}: <strong>{item.cantidad_stock}</strong> cajas (
                                {parrillas}P + {sueltas}S)
                              </div>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '13px', color: '#64748b' }}>Sin stock</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* === FINAL LIMÓN (arriba) + DESVERDIZADO (abajo) === */}
      {isLimon && (
        <>
          <h3>🍋 Inventario Final - Limón Amarillo</h3>
          {visibleLimonFinal.length > 0 ? (
            (() => {
              const grupos = visibleLimonFinal.reduce<
                Record<string, { label: string; total: number; presentacion: string }>
              >((acc, item) => {
                const pres = item.presentacion || 'otro';
                const tallaPart = item.talla ? `#${item.talla}` : '';
                const lotePart =
                  pres === 'rpc_granel' && item.lote ? ` lote ${item.lote}` : '';
                const fechaPart =
                  pres === 'rpc_granel' && item.fecha_empaque
                    ? ` ${formatFechaCorta(item.fecha_empaque)}`
                    : '';
                const key = `${pres}${tallaPart}${lotePart}${fechaPart}`;
                if (!acc[key]) {
                  const base =
                    pres === 'rpc_granel'
                      ? 'RPC a granel (22 kg)'
                      : pres === 'rpc_12'
                        ? 'RPC 12'
                        : pres === 'rpc_18'
                          ? 'RPC 18'
                          : pres === 'caja_40lbs'
                            ? 'Caja 40 lbs'
                            : pres === 'bins_jugo'
                              ? 'Bins 900kg'
                              : pres;
                  acc[key] = {
                    label: `${base} ${tallaPart}${lotePart}${fechaPart}`.trim(),
                    total: 0,
                    presentacion: pres,
                  };
                }
                acc[key].total += item.cantidad_stock || 0;
                return acc;
              }, {});

              return Object.entries(grupos).map(([groupKey, { label, total, presentacion }]) => (
                <div
                  key={groupKey}
                  style={{
                    marginBottom: '8px',
                    padding: '8px 12px',
                    background: '#fefce8',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <strong>{label}</strong>:{' '}
                  <strong style={{ color: '#14532d' }}>
                    {formatParrillasLimon(presentacion, total)}
                  </strong>
                </div>
              ));
            })()
          ) : (
            <p style={{ color: '#64748b' }}>No hay producto final de limón con stock.</p>
          )}

          <h3 style={{ marginTop: 28 }}>📦 Inventario en Desverdizado (Bins de Limón - 260kg)</h3>
          {visibleDesverdizado.length > 0 ? (
            <div style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
              {visibleDesverdizado.map((d, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '10px 14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    background: '#f8fafc',
                  }}
                >
                  <div>
                    <strong>Lote: {d.lote}</strong> — {d.cantidad_bins_disponibles} bins
                    disponibles
                  </div>
                  <div style={{ fontSize: '13px', color: '#475569' }}>
                    Corte: {formatFechaCorta(d.fecha_recepcion)} | Tentativa salida:{' '}
                    {formatFechaCorta(d.fecha_tentativa_salida)} | Estado:{' '}
                    <strong>{d.estado}</strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#64748b' }}>No hay bins en desverdizado con stock.</p>
          )}

          {/* Proyección de inventario (antes en Producción) */}
          <h3 style={{ marginTop: 32 }}>🔮 Proyección de inventario final</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, maxWidth: 720 }}>
            Si se empaca todo el desverdizado (recepción + {DIAS_DESVERDIZADO} días), aplicando el
            rendimiento histórico. 1ra ≈ parrillas · 2da ≈ bins jugo.
          </p>
          {!proyeccion ? (
            <p style={{ color: '#64748b' }}>No se pudo cargar la proyección.</p>
          ) : (
            <>
              <div
                style={{
                  background: proyeccion.factores.con_datos ? '#f0fdf4' : '#fef2f2',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <strong>Factores del histórico</strong>
                {proyeccion.factores.con_datos ? (
                  <div style={{ marginTop: 6 }}>
                    Sobre {proyeccion.factores.bins_historicos} bins empacados:{' '}
                    <strong>{proyeccion.factores.pct_primera}% 1ra</strong> ·{' '}
                    <strong>{proyeccion.factores.pct_segunda}% 2da</strong> · recup.{' '}
                    {proyeccion.factores.pct_recuperacion}%
                  </div>
                ) : (
                  <div style={{ color: '#b91c1c', marginTop: 6 }}>
                    {proyeccion.factores.nota || 'Falta histórico de empaque.'}
                  </div>
                )}
              </div>

              {(() => {
                const fromU = parrillasDesdeUnidades(proyeccion.unidades_totales || []);
                const label1ra =
                  (proyeccion.unidades_totales || []).length > 0
                    ? fromU.label1ra
                    : aproxParrillas1ra(proyeccion.total_kg_primera);
                const label2da =
                  fromU.binsJugo > 0
                    ? `≈ ${fromU.binsJugo} bin${fromU.binsJugo !== 1 ? 's' : ''} jugo`
                    : aproxBins2da(proyeccion.total_kg_segunda);
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '14px 16px',
                        minWidth: 140,
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#64748b' }}>Bins desverdizado</div>
                      <div style={{ fontSize: 26, fontWeight: 800 }}>
                        {proyeccion.total_bins_desverdizado}
                      </div>
                    </div>
                    <div
                      style={{
                        background: '#dcfce7',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '14px 16px',
                        minWidth: 180,
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#166534' }}>Kg 1ra proyectados</div>
                      <div style={{ fontSize: 26, fontWeight: 800 }}>
                        {proyeccion.total_kg_primera.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#14532d', marginTop: 4 }}>
                        {label1ra}
                      </div>
                    </div>
                    <div
                      style={{
                        background: '#fef9c3',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '14px 16px',
                        minWidth: 180,
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#854d0e' }}>Kg 2da proyectados</div>
                      <div style={{ fontSize: 26, fontWeight: 800 }}>
                        {proyeccion.total_kg_segunda.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#713f12', marginTop: 4 }}>
                        {label2da}
                      </div>
                    </div>
                    <div
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '14px 16px',
                        minWidth: 140,
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#64748b' }}>Kg salida total</div>
                      <div style={{ fontSize: 26, fontWeight: 800 }}>
                        {proyeccion.total_kg_salida.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {proyeccion.por_lote.length > 0 && (
                <>
                  <h4 style={{ marginBottom: 8 }}>Proyección por lote en desverdizado</h4>
                  <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 13,
                        minWidth: 640,
                      }}
                    >
                      <thead>
                        <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                          <th style={{ padding: '10px 8px' }}>Lote</th>
                          <th style={{ padding: '10px 8px' }}>Bins</th>
                          <th style={{ padding: '10px 8px' }}>Salida tent.</th>
                          <th style={{ padding: '10px 8px' }}>kg 1ra</th>
                          <th style={{ padding: '10px 8px' }}>kg 2da / bins</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proyeccion.por_lote.map((l) => (
                          <tr
                            key={`${l.lote}-${l.fecha_tentativa_salida}`}
                            style={{ borderBottom: '1px solid #e2e8f0' }}
                          >
                            <td style={{ padding: '10px 8px' }}>
                              <strong>{l.lote}</strong>
                            </td>
                            <td style={{ padding: '10px 8px' }}>{l.bins}</td>
                            <td style={{ padding: '10px 8px' }}>{l.fecha_tentativa_salida}</td>
                            <td style={{ padding: '10px 8px' }}>
                              {l.kg_primera.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}{' '}
                              kg
                              <div style={{ fontSize: 11, color: '#166534' }}>
                                {aproxParrillas1ra(l.kg_primera)}
                              </div>
                            </td>
                            <td style={{ padding: '10px 8px' }}>
                              {l.kg_segunda.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}{' '}
                              kg
                              <div style={{ fontSize: 11, color: '#854d0e' }}>
                                {aproxBins2da(l.kg_segunda)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* === INVENTARIO DE CAMPO (Uva) === */}
      {isUva && (
        <>
          <h3 style={{ marginTop: '30px' }}>Inventario de Campo (por Variedad y Mercado)</h3>
          {inventarioCampo.filter((i) => i.cantidad > 0).length > 0 ? (
            Object.values(
              inventarioCampo
                .filter((i) => i.cantidad > 0)
                .reduce<Record<string, InventarioCampoItem[]>>((acc, item) => {
                  if (!acc[item.variedad]) acc[item.variedad] = [];
                  acc[item.variedad].push(item);
                  return acc;
                }, {})
            ).map((grupo, idx: number) => {
              const variedad = grupo[0].variedad;
              const totalVariedad = grupo.reduce((sum, i) => sum + i.cantidad, 0);

              return (
                <div
                  key={idx}
                  style={{
                    marginBottom: '18px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '10px',
                    }}
                  >
                    <strong style={{ fontSize: '15px' }}>{variedad}</strong>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>
                      Total: <strong>{totalVariedad}</strong> cajas de campo
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    {['nacional', 'exportacion'].map((mkt) => {
                      const itemDelMercado = grupo.find((i) => i.mercado === mkt);
                      const cantidad = itemDelMercado ? itemDelMercado.cantidad : 0;

                      return (
                        <div
                          key={mkt}
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            background: mkt === 'exportacion' ? '#dbeafe' : '#dcfce7',
                            borderRadius: '6px',
                            borderLeft:
                              mkt === 'exportacion' ? '4px solid #3b82f6' : '4px solid #22c55e',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: mkt === 'exportacion' ? '#1e40af' : '#166534',
                              marginBottom: '4px',
                            }}
                          >
                            {mkt.toUpperCase()}
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: 700 }}>{cantidad}</div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>cajas</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <p style={{ color: '#64748b' }}>No hay inventario de campo con stock.</p>
          )}
        </>
      )}
    </div>
  );
}
