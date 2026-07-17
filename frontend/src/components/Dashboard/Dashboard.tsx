import { useState } from 'react';
import type { InventarioCampoItem, InventarioFinalItem, DesverdizadoItem } from '../../types';
import { formatFechaCorta } from '../../lib/dates';

interface DashboardProps {
  inventarioCampo: InventarioCampoItem[];
  inventarioCarton: InventarioFinalItem[];
  desverdizado?: DesverdizadoItem[];
}

const calcularParrillas = (cajas: number) => {
  const parrillas = Math.floor(cajas / 90);
  const sueltas = cajas % 90;
  return { parrillas, sueltas };
};

export default function Dashboard({ inventarioCampo, inventarioCarton, desverdizado = [] }: DashboardProps) {
  const [productTab, setProductTab] = useState<'uva' | 'limon'>('limon');

  const isUva = productTab === 'uva';
  const isLimon = productTab === 'limon';

  // Filter data
  const uvaFinalItems = inventarioCarton.filter(i => !i.presentacion && (i.producto === 'uva' || !i.producto));
  const limonFinalItems = inventarioCarton.filter(i => i.producto === 'limon_amarillo' || !!i.presentacion);
  const visibleDesverdizado = (desverdizado || [])
    .filter((d) => d.cantidad_bins_disponibles > 0)
    .slice()
    .sort((a, b) => {
      const fa = String(a.fecha_recepcion || '');
      const fb = String(b.fecha_recepcion || '');
      if (fa !== fb) return fa.localeCompare(fb);
      return String(a.lote || '').localeCompare(String(b.lote || ''));
    });
  const visibleUvaFinal = uvaFinalItems.filter(i => (i.cantidad_stock || 0) > 0);
  const visibleLimonFinal = limonFinalItems.filter(i => (i.cantidad_stock || 0) > 0);

  return (
    <div style={{background: 'white', padding: '25px', borderRadius: '10px'}}>
      <h2>📦 Inventarios</h2>

      {/* Tabs / Selector de grupo de producto */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
        <button
          onClick={() => setProductTab('uva')}
          style={{
            padding: '8px 16px',
            background: isUva ? '#15803d' : '#f1f5f9',
            color: isUva ? 'white' : '#334155',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Uva
        </button>
        <button
          onClick={() => setProductTab('limon')}
          style={{
            padding: '8px 16px',
            background: isLimon ? '#15803d' : '#f1f5f9',
            color: isLimon ? 'white' : '#334155',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Limón Amarillo
        </button>
      </div>

      {/* Resumen rápido - condicional por pestaña */}
      <div style={{display: 'flex', gap: '20px', marginBottom: '25px', flexWrap: 'wrap'}}>
        {isUva && (
          <>
            <div style={{background: '#f1f5f9', padding: '12px 20px', borderRadius: '8px'}}>
              <strong>Total Campo:</strong> {inventarioCampo.reduce((sum, i) => sum + i.cantidad, 0)} cajas
            </div>
            <div style={{background: '#f1f5f9', padding: '12px 20px', borderRadius: '8px'}}>
              <strong>Total Final Uva:</strong> {visibleUvaFinal.reduce((sum, i) => sum + (i.cantidad_stock || 0), 0)} cajas
            </div>
          </>
        )}
        {isLimon && (
          <>
            <div style={{background: '#e0f2fe', padding: '12px 20px', borderRadius: '8px'}}>
              <strong>Bins en Desverdizado:</strong> {visibleDesverdizado.reduce((sum, d) => sum + (d.cantidad_bins_disponibles || 0), 0)} bins
            </div>
            <div style={{background: '#fefce8', padding: '12px 20px', borderRadius: '8px'}}>
              <strong>Total Final Limón:</strong>{' '}
              RPC: {visibleLimonFinal.filter(i => i.presentacion?.startsWith('rpc_')).reduce((sum, i) => sum + (i.cantidad_stock || 0), 0)}{' '}
              | Cajas: {visibleLimonFinal.filter(i => i.presentacion === 'caja_40lbs').reduce((sum, i) => sum + (i.cantidad_stock || 0), 0)}{' '}
              | Bins: {visibleLimonFinal.filter(i => i.presentacion === 'bins_jugo').reduce((sum, i) => sum + (i.cantidad_stock || 0), 0)}
            </div>
          </>
        )}
      </div>

      {/* === INVENTARIO FINAL UVA (solo si pestaña Uva) === */}
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
              <div key={idx} style={{marginBottom: '18px', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
                  <strong style={{fontSize: '15px'}}>{variedad}</strong>
                  <span style={{fontSize: '13px', color: '#64748b'}}>
                    Total: <strong>{totalVariedad}</strong> cajas ({totalParrillas} parrillas + {totalSueltas} sueltas)
                  </span>
                </div>

                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px'}}>
                  {['nacional', 'exportacion'].map(mkt => {
                    const itemsDelMercado = grupo.filter((i) => i.mercado === mkt);
                    return (
                      <div key={mkt} style={{
                        padding: '10px 12px',
                        background: mkt === 'exportacion' ? '#dbeafe' : '#dcfce7',
                        borderRadius: '6px'
                      }}>
                        <div style={{fontSize: '12px', fontWeight: 600, color: mkt === 'exportacion' ? '#1e40af' : '#166534', marginBottom: '4px'}}>
                          {mkt.toUpperCase()}
                        </div>
                        {itemsDelMercado.length > 0 ? itemsDelMercado.map((item, i3: number) => {
                          const { parrillas, sueltas } = calcularParrillas(item.cantidad_stock);
                          return (
                            <div key={i3} style={{fontSize: '13px', marginBottom: '2px'}}>
                              {item.tipo_cultivo}: <strong>{item.cantidad_stock}</strong> cajas ({parrillas}P + {sueltas}S)
                            </div>
                          );
                        }) : (
                          <div style={{fontSize: '13px', color: '#64748b'}}>Sin stock</div>
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

      {/* === DESVERDIZADO + FINAL LIMÓN (solo si pestaña Limón) === */}
      {isLimon && (
        <>
          {/* Inventario en Desverdizado */}
          <h3>📦 Inventario en Desverdizado (Bins de Limón - 260kg)</h3>
          {visibleDesverdizado.length > 0 ? (
            <div style={{display: 'grid', gap: '8px', marginBottom: '20px'}}>
              {visibleDesverdizado.map((d, idx) => (
                <div key={idx} style={{padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc'}}>
                  <div>
                    <strong>Lote: {d.lote}</strong> — {d.cantidad_bins_disponibles} bins disponibles
                  </div>
                  <div style={{fontSize: '13px', color: '#475569'}}>
                    Recepción: {formatFechaCorta(d.fecha_recepcion)} | Tentativa salida: {formatFechaCorta(d.fecha_tentativa_salida)} | Estado: <strong>{d.estado}</strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{color: '#64748b'}}>No hay bins en desverdizado con stock.</p>
          )}

          {/* Inventario Final Limón - simplificado y limpio */}
          <h3>🍋 Inventario Final - Limón Amarillo</h3>
          {visibleLimonFinal.length > 0 ? (
            (() => {
              const grupos = visibleLimonFinal.reduce<Record<string, {label: string, total: number}>>((acc, item) => {
                const pres = item.presentacion || 'otro';
                const tallaPart = item.talla ? `#${item.talla}` : '';
                const key = `${pres}${tallaPart}`;
                if (!acc[key]) {
                  const base = pres === 'rpc_12' ? 'RPC 12' :
                               pres === 'rpc_18' ? 'RPC 18' :
                               pres === 'caja_40lbs' ? 'Caja 40 lbs' :
                               pres === 'bins_jugo' ? 'Bins 900kg' : pres;
                  acc[key] = { label: `${base} ${tallaPart}`.trim(), total: 0 };
                }
                acc[key].total += (item.cantidad_stock || 0);
                return acc;
              }, {});

              return Object.entries(grupos).map(([groupKey, {label, total}]) => (
                <div key={groupKey} style={{marginBottom: '8px', padding: '8px 12px', background: '#fefce8', borderRadius: '6px', border: '1px solid #e2e8f0'}}>
                  <strong>{label}</strong>: {total}
                </div>
              ));
            })()
          ) : (
            <p style={{color: '#64748b'}}>No hay producto final de limón con stock.</p>
          )}
        </>
      )}

      {/* === INVENTARIO DE CAMPO (solo si pestaña Uva) === */}
      {isUva && (
        <>
          <h3 style={{marginTop: '30px'}}>Inventario de Campo (por Variedad y Mercado)</h3>
          {inventarioCampo.filter(i => i.cantidad > 0).length > 0 ? (
            Object.values(
              inventarioCampo.filter(i => i.cantidad > 0).reduce<Record<string, InventarioCampoItem[]>>((acc, item) => {
                if (!acc[item.variedad]) acc[item.variedad] = [];
                acc[item.variedad].push(item);
                return acc;
              }, {})
            ).map((grupo, idx: number) => {
              const variedad = grupo[0].variedad;
              const totalVariedad = grupo.reduce((sum, i) => sum + i.cantidad, 0);

              return (
                <div key={idx} style={{marginBottom: '18px', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
                    <strong style={{fontSize: '15px'}}>{variedad}</strong>
                    <span style={{fontSize: '13px', color: '#64748b'}}>
                      Total: <strong>{totalVariedad}</strong> cajas de campo
                    </span>
                  </div>

                  <div style={{display: 'flex', gap: '12px'}}>
                    {['nacional', 'exportacion'].map(mkt => {
                      const itemDelMercado = grupo.find((i) => i.mercado === mkt);
                      const cantidad = itemDelMercado ? itemDelMercado.cantidad : 0;

                      return (
                        <div key={mkt} style={{
                          flex: 1,
                          padding: '12px 14px',
                          background: mkt === 'exportacion' ? '#dbeafe' : '#dcfce7',
                          borderRadius: '6px',
                          borderLeft: mkt === 'exportacion' ? '4px solid #3b82f6' : '4px solid #22c55e'
                        }}>
                          <div style={{fontSize: '12px', fontWeight: 600, color: mkt === 'exportacion' ? '#1e40af' : '#166534', marginBottom: '4px'}}>
                            {mkt.toUpperCase()}
                          </div>
                          <div style={{fontSize: '18px', fontWeight: 700}}>
                            {cantidad} <span style={{fontSize: '14px', fontWeight: 400}}>cajas</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <p style={{color: '#64748b'}}>No hay inventario de campo con stock.</p>
          )}
        </>
      )}
    </div>
  );
}
