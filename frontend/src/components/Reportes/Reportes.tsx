import { useEffect, useState, type CSSProperties } from 'react';
import {
  getRendimientosLimon,
  getEmpaques,
  type CorridaRendimientoApi,
  type LoteRendimientoApi,
} from '../../lib/api';
import { PESO_BIN_CAMPO_KG } from '../../lib/constants';
import type { EmpaqueRecord } from '../../types';

type Corrida = CorridaRendimientoApi;
type Lote = LoteRendimientoApi;

interface ReportesProps {
  token: string;
}

const KG_PRES: Record<string, number> = {
  rpc_12: 12,
  rpc_18: 18,
  caja_40lbs: 18,
  bins_jugo: 900,
};
const CAJAS_PARRILLA_RPC = 45;
const CAJAS_PARRILLA_CARTON = 63;

const cardStyle: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 140,
};

function fmtKg(n: number) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function parseDetalle(raw: EmpaqueRecord['detalle_corrida'] | string | null | undefined) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as NonNullable<EmpaqueRecord['detalle_corrida']>;
    } catch {
      return null;
    }
  }
  return raw;
}

/** Calcula rendimientos en el cliente a partir de /api/empaque/ (fallback) */
function computeFromEmpaques(empaques: EmpaqueRecord[]): {
  corridas: Corrida[];
  por_lote: Lote[];
  acumulado: Corrida;
} {
  const limones = empaques.filter((e) => {
    const p = String(e.producto || '').toLowerCase();
    return p.includes('limon');
  });

  const corridas: Corrida[] = [];
  const loteAcc = new Map<
    string,
    {
      bins: number;
      kg1: number;
      kg2: number;
      rpc: number;
      carton: number;
      jugo: number;
      ids: Set<number>;
      multi: boolean;
    }
  >();

  for (const e of limones) {
    const det = parseDetalle(e.detalle_corrida as any);
    if (det?.anulado) continue;

    let consumos = det?.consumos || [];
    let produccion = det?.produccion || [];

    if ((!consumos || consumos.length === 0) && (e.bins_desverdizado_usados || 0) > 0) {
      consumos = [
        {
          lote: e.lote_desverdizado || 'SIN_LOTE',
          bins: e.bins_desverdizado_usados || 0,
        },
      ];
    }
    if ((!produccion || produccion.length === 0) && e.presentacion && e.cantidad_producida) {
      produccion = [
        {
          presentacion: e.presentacion,
          talla: e.talla,
          cantidad: e.cantidad_producida,
        },
      ];
    }
    if (consumos.length === 0 && produccion.length === 0) continue;

    let kg1 = 0;
    let kg2 = 0;
    let cajasRpc = 0;
    let cajasCarton = 0;
    let binsJugo = 0;
    for (const p of produccion) {
      const cant = Number(p.cantidad) || 0;
      if (cant <= 0) continue;
      const kg = (KG_PRES[p.presentacion] || 0) * cant;
      if (p.presentacion === 'bins_jugo') {
        kg2 += kg;
        binsJugo += cant;
      } else if (p.presentacion === 'rpc_12' || p.presentacion === 'rpc_18') {
        kg1 += kg;
        cajasRpc += cant;
      } else if (p.presentacion === 'caja_40lbs') {
        kg1 += kg;
        cajasCarton += cant;
      } else {
        kg1 += kg;
      }
    }

    const binsCampo = consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0);
    const kgEntrada = binsCampo * PESO_BIN_CAMPO_KG;
    const kgSalida = kg1 + kg2;
    const parrRpc = cajasRpc ? cajasRpc / CAJAS_PARRILLA_RPC : 0;
    const parrCarton = cajasCarton ? cajasCarton / CAJAS_PARRILLA_CARTON : 0;
    const parrTotal = Math.round((parrRpc + parrCarton + binsJugo) * 100) / 100;
    const lotesResumen =
      det?.lotes_resumen ||
      consumos.map((c) => `${c.lote}:${c.bins}`).join(', ') ||
      e.lote_desverdizado ||
      '';

    corridas.push({
      id: e.id,
      fecha: e.fecha,
      numero_empacador: e.numero_empacador,
      bins_campo: binsCampo,
      kg_entrada: kgEntrada,
      kg_primera: Math.round(kg1 * 100) / 100,
      kg_segunda: Math.round(kg2 * 100) / 100,
      kg_salida: Math.round(kgSalida * 100) / 100,
      pct_primera: kgEntrada ? Math.round((kg1 / kgEntrada) * 10000) / 100 : 0,
      pct_segunda: kgEntrada ? Math.round((kg2 / kgEntrada) * 10000) / 100 : 0,
      pct_recuperacion: kgEntrada ? Math.round((kgSalida / kgEntrada) * 10000) / 100 : 0,
      cajas_rpc: cajasRpc,
      cajas_carton: cajasCarton,
      bins_jugo: binsJugo,
      parrillas_rpc: Math.round(parrRpc * 100) / 100,
      parrillas_carton: Math.round(parrCarton * 100) / 100,
      parrillas_jugo: binsJugo,
      parrillas_total: parrTotal,
      bins_por_parrilla: parrTotal > 0 ? Math.round((binsCampo / parrTotal) * 100) / 100 : null,
      lotes_resumen: lotesResumen,
    });

    const totalBins = consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0) || 1;
    const multi = new Set(consumos.map((c) => c.lote || 'SIN_LOTE')).size > 1;
    for (const c of consumos) {
      const lote = String(c.lote || 'SIN_LOTE').trim() || 'SIN_LOTE';
      const bins = Number(c.bins) || 0;
      if (bins <= 0) continue;
      const share = bins / totalBins;
      const row = loteAcc.get(lote) || {
        bins: 0,
        kg1: 0,
        kg2: 0,
        rpc: 0,
        carton: 0,
        jugo: 0,
        ids: new Set<number>(),
        multi: false,
      };
      row.bins += bins;
      row.kg1 += kg1 * share;
      row.kg2 += kg2 * share;
      row.rpc += cajasRpc * share;
      row.carton += cajasCarton * share;
      row.jugo += binsJugo * share;
      row.ids.add(e.id);
      if (multi) row.multi = true;
      loteAcc.set(lote, row);
    }
  }

  const por_lote: Lote[] = Array.from(loteAcc.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lote, row]) => {
      const kgEntrada = row.bins * PESO_BIN_CAMPO_KG;
      const kgSalida = row.kg1 + row.kg2;
      const cRpc = Math.round(row.rpc);
      const cCarton = Math.round(row.carton);
      const bJugo = Math.round(row.jugo);
      const parr =
        Math.round(
          ((cRpc ? cRpc / CAJAS_PARRILLA_RPC : 0) +
            (cCarton ? cCarton / CAJAS_PARRILLA_CARTON : 0) +
            bJugo) *
            100
        ) / 100;
      return {
        lote,
        bins_campo: row.bins,
        kg_entrada: Math.round(kgEntrada * 100) / 100,
        kg_primera: Math.round(row.kg1 * 100) / 100,
        kg_segunda: Math.round(row.kg2 * 100) / 100,
        kg_salida: Math.round(kgSalida * 100) / 100,
        pct_primera: kgEntrada ? Math.round((row.kg1 / kgEntrada) * 10000) / 100 : 0,
        pct_segunda: kgEntrada ? Math.round((row.kg2 / kgEntrada) * 10000) / 100 : 0,
        pct_recuperacion: kgEntrada ? Math.round((kgSalida / kgEntrada) * 10000) / 100 : 0,
        cajas_rpc: cRpc,
        cajas_carton: cCarton,
        bins_jugo: bJugo,
        parrillas_total: parr,
        num_corridas: row.ids.size,
        prorrateado: row.multi,
      };
    });

  const bins = corridas.reduce((s, c) => s + c.bins_campo, 0);
  const kg1 = corridas.reduce((s, c) => s + c.kg_primera, 0);
  const kg2 = corridas.reduce((s, c) => s + c.kg_segunda, 0);
  const kgE = bins * PESO_BIN_CAMPO_KG;
  const kgS = kg1 + kg2;
  const cRpc = corridas.reduce((s, c) => s + c.cajas_rpc, 0);
  const cCarton = corridas.reduce((s, c) => s + c.cajas_carton, 0);
  const bJugo = corridas.reduce((s, c) => s + c.bins_jugo, 0);
  const pRpc = cRpc ? cRpc / CAJAS_PARRILLA_RPC : 0;
  const pCarton = cCarton ? cCarton / CAJAS_PARRILLA_CARTON : 0;
  const pTotal = Math.round((pRpc + pCarton + bJugo) * 100) / 100;

  const acumulado: Corrida = {
    id: 0,
    fecha: 'acumulado',
    numero_empacador: null,
    bins_campo: bins,
    kg_entrada: kgE,
    kg_primera: Math.round(kg1 * 100) / 100,
    kg_segunda: Math.round(kg2 * 100) / 100,
    kg_salida: Math.round(kgS * 100) / 100,
    pct_primera: kgE ? Math.round((kg1 / kgE) * 10000) / 100 : 0,
    pct_segunda: kgE ? Math.round((kg2 / kgE) * 10000) / 100 : 0,
    pct_recuperacion: kgE ? Math.round((kgS / kgE) * 10000) / 100 : 0,
    cajas_rpc: cRpc,
    cajas_carton: cCarton,
    bins_jugo: bJugo,
    parrillas_rpc: Math.round(pRpc * 100) / 100,
    parrillas_carton: Math.round(pCarton * 100) / 100,
    parrillas_jugo: bJugo,
    parrillas_total: pTotal,
    bins_por_parrilla: pTotal > 0 ? Math.round((bins / pTotal) * 100) / 100 : null,
    lotes_resumen: `${corridas.length} corridas`,
  };

  return { corridas, por_lote, acumulado };
}

export default function Reportes({ token }: ReportesProps) {
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [porLote, setPorLote] = useState<Lote[]>([]);
  const [acumulado, setAcumulado] = useState<Corrida | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [vista, setVista] = useState<'lote' | 'corrida'>('lote');
  const [debugInfo, setDebugInfo] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    setAviso('');
    setDebugInfo('');
    try {
      let data: { corridas: Corrida[]; por_lote: Lote[]; acumulado: Corrida | null } | null = null;

      try {
        const apiData = await getRendimientosLimon(token);
        data = {
          corridas: apiData.corridas || [],
          por_lote: apiData.por_lote || [],
          acumulado: apiData.acumulado || null,
        };
      } catch (err: any) {
        console.warn('rendimientos-limon falló, usando fallback empaques', err);
        setAviso('Usando cálculo local desde empaques (el endpoint de reportes no respondió).');
      }

      // Fallback o si el API devolvió vacío pero hay empaques con detalle
      if (!data || (data.corridas.length === 0 && data.por_lote.length === 0)) {
        const empaques = await getEmpaques(token);
        const limon = empaques.filter((e) => String(e.producto || '').toLowerCase().includes('limon'));
        const conDetalle = limon.filter((e) => {
          const d = parseDetalle(e.detalle_corrida as any);
          return Boolean(
            d?.consumos?.length ||
              d?.produccion?.length ||
              (e.bins_desverdizado_usados || 0) > 0
          );
        });
        setDebugInfo(
          `Empaques limón: ${limon.length} · Con datos de corrida: ${conDetalle.length}`
        );
        const computed = computeFromEmpaques(empaques);
        if (computed.corridas.length > 0) {
          data = computed;
          if (!aviso) {
            setAviso('Datos calculados desde registros de empaque.');
          }
        } else if (!data) {
          data = computed;
        }
      }

      setCorridas(data?.corridas || []);
      setPorLote(data?.por_lote || []);
      setAcumulado(data?.acumulado || null);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : e?.message || 'Error al cargar reportes'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  if (loading) {
    return (
      <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
        <h2>📊 Reportes de rendimiento (Limón)</h2>
        <p style={{ color: '#64748b' }}>Cargando… (si la API estaba dormida puede tardar ~30s)</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
        <h2>📊 Reportes de rendimiento (Limón)</h2>
        <p style={{ color: '#dc2626' }}>{error}</p>
        <button type="button" onClick={load} style={{ padding: '8px 16px' }}>
          Reintentar
        </button>
      </div>
    );
  }

  const a = acumulado;
  const tabBtn = (id: 'lote' | 'corrida'): CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: vista === id ? 700 : 400,
    background: vista === id ? '#15803d' : '#f1f5f9',
    color: vista === id ? 'white' : '#334155',
  });

  return (
    <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>📊 Reportes de rendimiento (Limón)</h2>
        <button type="button" onClick={load} style={{ padding: '8px 14px' }}>
          Actualizar
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
        Bin campo = {PESO_BIN_CAMPO_KG} kg · RPC 12 = 12 kg · RPC 18 / cartón = 18 kg · Bin jugo = 900 kg ·
        Parrilla RPC = 45 cajas · Parrilla cartón = 63 cajas · 1 bin jugo = 1 parrilla
      </p>

      {aviso && (
        <p style={{ fontSize: 13, color: '#854d0e', background: '#fef9c3', padding: 10, borderRadius: 8 }}>
          {aviso}
        </p>
      )}
      {debugInfo && (
        <p style={{ fontSize: 12, color: '#64748b' }}>{debugInfo}</p>
      )}

      {/* Acumulado */}
      {a && a.bins_campo > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Acumulado (todas las corridas)</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Bins de campo</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{a.bins_campo}</div>
              <div style={{ fontSize: 12 }}>{fmtKg(a.kg_entrada)} kg entrada</div>
            </div>
            <div style={{ ...cardStyle, background: '#dcfce7' }}>
              <div style={{ fontSize: 12, color: '#166534' }}>1ra calidad (kg)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKg(a.kg_primera)}</div>
              <div style={{ fontSize: 12 }}>{a.pct_primera}% del campo</div>
            </div>
            <div style={{ ...cardStyle, background: '#fef9c3' }}>
              <div style={{ fontSize: 12, color: '#854d0e' }}>2da calidad / jugo (kg)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKg(a.kg_segunda)}</div>
              <div style={{ fontSize: 12 }}>{a.pct_segunda}% del campo</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Kg totales producidos</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKg(a.kg_salida)}</div>
              <div style={{ fontSize: 12 }}>{a.pct_recuperacion}% recuperación</div>
            </div>
            <div style={{ ...cardStyle, background: '#e0f2fe' }}>
              <div style={{ fontSize: 12, color: '#075985' }}>Parrillas totales</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{a.parrillas_total}</div>
              <div style={{ fontSize: 12 }}>
                RPC {a.parrillas_rpc} · Cartón {a.parrillas_carton} · Jugo {a.parrillas_jugo}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Bins → Parrillas</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {a.bins_campo} bins → {a.parrillas_total} parrillas
              </div>
              <div style={{ fontSize: 12 }}>
                {a.bins_por_parrilla != null
                  ? `${a.bins_por_parrilla} bins de campo por parrilla`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 24, marginBottom: 12 }}>
        <button type="button" style={tabBtn('lote')} onClick={() => setVista('lote')}>
          Por lote
        </button>
        <button type="button" style={tabBtn('corrida')} onClick={() => setVista('corrida')}>
          Por corrida
        </button>
      </div>

      {vista === 'lote' && (
        <>
          <h3 style={{ marginTop: 8 }}>Rendimiento por lote</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
            Por cada lote: kg entrada, kg totales producidos, 1ra (RPC/cartón) y 2da (bins jugo). Si un
            empaque mezcló lotes, la producción se reparte por proporción de bins.
          </p>
          {porLote.length === 0 ? (
            <div>
              <p style={{ color: '#64748b' }}>
                No hay lotes con empaque usable. Solo cuentan registros de limón que tengan consumos
                (bins de lote) y/o producción guardados en el empaque.
              </p>
              <p style={{ fontSize: 13, color: '#64748b' }}>
                Si acabas de empacar: pulsa <strong>Actualizar</strong>. Si el empaque salió sin
                detalle (bins en 0), corrígelo en <strong>Correcciones</strong> o regístralo de nuevo.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  minWidth: 860,
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>Lote</th>
                    <th style={th}>Bins campo</th>
                    <th style={th}>kg entrada</th>
                    <th style={th}>kg total prod.</th>
                    <th style={th}>kg 1ra</th>
                    <th style={th}>% 1ra</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>% 2da</th>
                    <th style={th}>% recup.</th>
                    <th style={th}>Parrillas</th>
                    <th style={th}>Corridas</th>
                  </tr>
                </thead>
                <tbody>
                  {porLote.map((l) => (
                    <tr key={l.lote} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>
                        <strong>{l.lote}</strong>
                        {l.prorrateado && (
                          <div style={{ fontSize: 11, color: '#b45309' }}>
                            * prorrateado (mezcla)
                          </div>
                        )}
                      </td>
                      <td style={td}>{l.bins_campo}</td>
                      <td style={td}>{fmtKg(l.kg_entrada)}</td>
                      <td style={td}>
                        <strong>{fmtKg(l.kg_salida)}</strong>
                      </td>
                      <td style={{ ...td, background: '#f0fdf4' }}>{fmtKg(l.kg_primera)}</td>
                      <td style={td}>
                        <strong>{l.pct_primera}%</strong>
                      </td>
                      <td style={{ ...td, background: '#fefce8' }}>{fmtKg(l.kg_segunda)}</td>
                      <td style={td}>
                        <strong>{l.pct_segunda}%</strong>
                      </td>
                      <td style={td}>{l.pct_recuperacion}%</td>
                      <td style={td}>{l.parrillas_total}</td>
                      <td style={td}>{l.num_corridas}</td>
                    </tr>
                  ))}
                </tbody>
                {porLote.length > 1 && (
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                      <td style={td}>TOTAL</td>
                      <td style={td}>{porLote.reduce((s, l) => s + l.bins_campo, 0)}</td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_entrada, 0))}
                      </td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_salida, 0))}
                      </td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_primera, 0))}
                      </td>
                      <td style={td}>—</td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_segunda, 0))}
                      </td>
                      <td style={td}>—</td>
                      <td style={td}>—</td>
                      <td style={td}>
                        {porLote.reduce((s, l) => s + l.parrillas_total, 0).toFixed(1)}
                      </td>
                      <td style={td}>—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}

      {vista === 'corrida' && (
        <>
          <h3 style={{ marginTop: 8 }}>Por corrida de empaque</h3>
          {corridas.length === 0 ? (
            <p style={{ color: '#64748b' }}>
              No hay corridas con detalle. Revisa en Correcciones que el empaque tenga consumos y
              producción.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  minWidth: 900,
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>#</th>
                    <th style={th}>Fecha</th>
                    <th style={th}>Lotes</th>
                    <th style={th}>Bins campo</th>
                    <th style={th}>kg total</th>
                    <th style={th}>kg 1ra</th>
                    <th style={th}>% 1ra</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>% 2da</th>
                    <th style={th}>% recup.</th>
                    <th style={th}>Parrillas</th>
                    <th style={th}>Bins → Parr.</th>
                  </tr>
                </thead>
                <tbody>
                  {corridas.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>{c.id}</td>
                      <td style={td}>{c.fecha}</td>
                      <td style={td}>{c.lotes_resumen || '—'}</td>
                      <td style={td}>
                        {c.bins_campo}
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtKg(c.kg_entrada)} kg</div>
                      </td>
                      <td style={td}>
                        <strong>{fmtKg(c.kg_salida)}</strong>
                      </td>
                      <td style={td}>{fmtKg(c.kg_primera)}</td>
                      <td style={td}>
                        <strong>{c.pct_primera}%</strong>
                      </td>
                      <td style={td}>{fmtKg(c.kg_segunda)}</td>
                      <td style={td}>
                        <strong>{c.pct_segunda}%</strong>
                      </td>
                      <td style={td}>{c.pct_recuperacion}%</td>
                      <td style={td}>
                        <strong>{c.parrillas_total}</strong>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          R{c.parrillas_rpc} / C{c.parrillas_carton} / J{c.parrillas_jugo}
                        </div>
                      </td>
                      <td style={td}>
                        {c.bins_campo} → {c.parrillas_total}
                        {c.bins_por_parrilla != null && (
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {c.bins_por_parrilla} bins/parr.
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const th: CSSProperties = {
  padding: '10px 8px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '10px 8px',
  verticalAlign: 'top',
};
