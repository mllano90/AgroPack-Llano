import { useEffect, useState, type CSSProperties } from 'react';
import {
  getRendimientosLimon,
  getProyeccionInventario,
  getEmpaques,
  type CorridaRendimientoApi,
  type LoteRendimientoApi,
  type TallaRendimientoApi,
  type ProyeccionInventarioApi,
} from '../../lib/api';
import {
  PESO_BIN_CAMPO_KG,
  HECTAREAS_RANCHO,
  HECTAREAS_POR_LOTE,
  DIAS_DESVERDIZADO,
} from '../../lib/constants';
import type { EmpaqueRecord } from '../../types';

type Corrida = CorridaRendimientoApi;
type Lote = LoteRendimientoApi;
type VistaReporte = 'lote' | 'corrida' | 'proyeccion';

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

const cardPrimary: CSSProperties = {
  ...cardStyle,
  minWidth: 160,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

function fmtKg(n: number) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function kgHa(kg: number, ha: number) {
  if (!ha) return null;
  return Math.round((kg / ha) * 100) / 100;
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

function enrichCorrida(c: Corrida, ha: number): Corrida {
  const parrPrimera =
    c.parrillas_primera != null
      ? c.parrillas_primera
      : Math.round(((c.parrillas_rpc || 0) + (c.parrillas_carton || 0)) * 100) / 100;
  const binsPorParrilla =
    parrPrimera > 0
      ? Math.round((c.bins_campo / parrPrimera) * 100) / 100
      : null;
  return {
    ...c,
    parrillas_primera: parrPrimera,
    // Siempre bins / parrillas 1ra (no jugo)
    bins_por_parrilla: binsPorParrilla,
    kg_por_ha: c.kg_por_ha ?? kgHa(c.kg_salida, ha),
    kg_primera_por_ha: c.kg_primera_por_ha ?? kgHa(c.kg_primera, ha),
    kg_segunda_por_ha: c.kg_segunda_por_ha ?? kgHa(c.kg_segunda, ha),
  };
}

function enrichLote(l: Lote, haPorLote: number = HECTAREAS_POR_LOTE): Lote {
  const parrPrimera =
    l.parrillas_primera != null
      ? l.parrillas_primera
      : (() => {
          const pRpc = l.cajas_rpc ? l.cajas_rpc / CAJAS_PARRILLA_RPC : 0;
          const pCarton = l.cajas_carton ? l.cajas_carton / CAJAS_PARRILLA_CARTON : 0;
          return Math.round((pRpc + pCarton) * 100) / 100;
        })();
  // kg/ha por lote siempre sobre 8 ha (no el rancho completo)
  return {
    ...l,
    parrillas_primera: parrPrimera,
    bins_por_parrilla:
      parrPrimera > 0
        ? Math.round((l.bins_campo / parrPrimera) * 100) / 100
        : null,
    kg_por_ha: kgHa(l.kg_salida, haPorLote),
    kg_primera_por_ha: kgHa(l.kg_primera, haPorLote),
    kg_segunda_por_ha: kgHa(l.kg_segunda, haPorLote),
  };
}

/** Calcula rendimientos en el cliente a partir de /api/empaque/ (fallback) */
function computeFromEmpaques(
  empaques: EmpaqueRecord[],
  ha: number
): {
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
    let kgRpc = 0;
    let kgCarton = 0;
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
        kgRpc += kg;
        cajasRpc += cant;
      } else if (p.presentacion === 'caja_40lbs') {
        kg1 += kg;
        kgCarton += kg;
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
    const parrPrimera = Math.round((parrRpc + parrCarton) * 100) / 100;
    const parrTotal = Math.round((parrPrimera + binsJugo) * 100) / 100;
    const lotesResumen =
      det?.lotes_resumen ||
      consumos.map((c) => `${c.lote}:${c.bins}`).join(', ') ||
      e.lote_desverdizado ||
      '';

    corridas.push(
      enrichCorrida(
        {
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
          kg_rpc: Math.round(kgRpc * 100) / 100,
          kg_carton: Math.round(kgCarton * 100) / 100,
          pct_rpc_de_primera: kg1 ? Math.round((kgRpc / kg1) * 10000) / 100 : 0,
          pct_carton_de_primera: kg1 ? Math.round((kgCarton / kg1) * 10000) / 100 : 0,
          cajas_rpc: cajasRpc,
          cajas_carton: cajasCarton,
          bins_jugo: binsJugo,
          parrillas_rpc: Math.round(parrRpc * 100) / 100,
          parrillas_carton: Math.round(parrCarton * 100) / 100,
          parrillas_jugo: binsJugo,
          parrillas_primera: parrPrimera,
          parrillas_total: parrTotal,
          bins_por_parrilla:
            parrPrimera > 0 ? Math.round((binsCampo / parrPrimera) * 100) / 100 : null,
          lotes_resumen: lotesResumen,
        },
        ha
      )
    );

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
      const pRpc = cRpc ? cRpc / CAJAS_PARRILLA_RPC : 0;
      const pCarton = cCarton ? cCarton / CAJAS_PARRILLA_CARTON : 0;
      const parrPrimera = Math.round((pRpc + pCarton) * 100) / 100;
      const parr = Math.round((parrPrimera + bJugo) * 100) / 100;
      return enrichLote(
        {
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
          parrillas_primera: parrPrimera,
          parrillas_total: parr,
          bins_por_parrilla:
            parrPrimera > 0 ? Math.round((row.bins / parrPrimera) * 100) / 100 : null,
          num_corridas: row.ids.size,
          prorrateado: row.multi,
        },
        ha
      );
    });

  const bins = corridas.reduce((s, c) => s + c.bins_campo, 0);
  const kg1 = corridas.reduce((s, c) => s + c.kg_primera, 0);
  const kg2 = corridas.reduce((s, c) => s + c.kg_segunda, 0);
  const kgRpcT = corridas.reduce((s, c) => s + (c.kg_rpc || 0), 0);
  const kgCartonT = corridas.reduce((s, c) => s + (c.kg_carton || 0), 0);
  const kgE = bins * PESO_BIN_CAMPO_KG;
  const kgS = kg1 + kg2;
  const cRpc = corridas.reduce((s, c) => s + c.cajas_rpc, 0);
  const cCarton = corridas.reduce((s, c) => s + c.cajas_carton, 0);
  const bJugo = corridas.reduce((s, c) => s + c.bins_jugo, 0);
  const pRpc = cRpc ? cRpc / CAJAS_PARRILLA_RPC : 0;
  const pCarton = cCarton ? cCarton / CAJAS_PARRILLA_CARTON : 0;
  const pPrimera = Math.round((pRpc + pCarton) * 100) / 100;
  const pTotal = Math.round((pPrimera + bJugo) * 100) / 100;

  const acumulado = enrichCorrida(
    {
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
      kg_rpc: Math.round(kgRpcT * 100) / 100,
      kg_carton: Math.round(kgCartonT * 100) / 100,
      pct_rpc_de_primera: kg1 ? Math.round((kgRpcT / kg1) * 10000) / 100 : 0,
      pct_carton_de_primera: kg1 ? Math.round((kgCartonT / kg1) * 10000) / 100 : 0,
      cajas_rpc: cRpc,
      cajas_carton: cCarton,
      bins_jugo: bJugo,
      parrillas_rpc: Math.round(pRpc * 100) / 100,
      parrillas_carton: Math.round(pCarton * 100) / 100,
      parrillas_jugo: bJugo,
      parrillas_primera: pPrimera,
      parrillas_total: pTotal,
      bins_por_parrilla: pPrimera > 0 ? Math.round((bins / pPrimera) * 100) / 100 : null,
      lotes_resumen: `${corridas.length} corridas`,
    },
    ha
  );

  return { corridas, por_lote, acumulado };
}

/** % por talla desde empaques (fallback cliente) */
function computeTallasFromEmpaques(empaques: EmpaqueRecord[]): TallaRendimientoApi[] {
  const kgT: Record<string, number> = {};
  const cajasT: Record<string, number> = {};
  let binsTotal = 0;
  let kg1 = 0;
  for (const e of empaques) {
    const det = parseDetalle(e.detalle_corrida as any);
    if (det?.anulado) continue;
    const consumos = det?.consumos || [];
    binsTotal += consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0);
    for (const p of det?.produccion || []) {
      if (p.presentacion === 'bins_jugo') continue;
      const cant = Number(p.cantidad) || 0;
      if (cant <= 0 || !p.talla) continue;
      const kg = (KG_PRES[p.presentacion] || 0) * cant;
      kgT[p.talla] = (kgT[p.talla] || 0) + kg;
      cajasT[p.talla] = (cajasT[p.talla] || 0) + cant;
      kg1 += kg;
    }
  }
  const kgE = binsTotal * PESO_BIN_CAMPO_KG;
  return Object.keys(kgT)
    .sort((a, b) => Number(a) - Number(b))
    .map((t) => ({
      talla: t,
      cajas: cajasT[t] || 0,
      kg: Math.round(kgT[t] * 100) / 100,
      pct_de_primera: kg1 ? Math.round((kgT[t] / kg1) * 10000) / 100 : 0,
      pct_de_entrada: kgE ? Math.round((kgT[t] / kgE) * 10000) / 100 : 0,
      parrillas: Math.round(((cajasT[t] || 0) / CAJAS_PARRILLA_RPC) * 100) / 100,
    }));
}

function labelPres(p: string) {
  const map: Record<string, string> = {
    rpc_12: 'RPC 12',
    rpc_18: 'RPC 18',
    caja_40lbs: 'Caja 40 lbs',
    bins_jugo: 'Bins jugo',
  };
  return map[p] || p;
}

/** RPC=45, cartón=63; sobrantes como parrillas + cajas */
function formatParrillas(
  presentacion: string,
  cantidad: number,
  labelFromApi?: string | null
): string {
  if (labelFromApi) return labelFromApi;
  const cajas = Math.round(cantidad || 0);
  if (presentacion === 'bins_jugo') {
    return cajas === 1 ? '1 parrilla' : `${cajas} parrillas`;
  }
  const div =
    presentacion === 'rpc_12' || presentacion === 'rpc_18'
      ? CAJAS_PARRILLA_RPC
      : presentacion === 'caja_40lbs'
        ? CAJAS_PARRILLA_CARTON
        : 0;
  if (!div) return `${cajas} cajas`;
  const parr = Math.floor(cajas / div);
  const sueltas = cajas % div;
  if (parr > 0 && sueltas > 0) return `${parr} parrilla${parr !== 1 ? 's' : ''} + ${sueltas} cajas`;
  if (parr > 0) return `${parr} parrilla${parr !== 1 ? 's' : ''}`;
  if (sueltas > 0) return `${sueltas} cajas`;
  return '0';
}

export default function Reportes({ token }: ReportesProps) {
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [porLote, setPorLote] = useState<Lote[]>([]);
  const [porTalla, setPorTalla] = useState<TallaRendimientoApi[]>([]);
  const [proyeccion, setProyeccion] = useState<ProyeccionInventarioApi | null>(null);
  const [acumulado, setAcumulado] = useState<Corrida | null>(null);
  const [hectareas, setHectareas] = useState(HECTAREAS_RANCHO);
  const [hectareasPorLote, setHectareasPorLote] = useState(HECTAREAS_POR_LOTE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [vista, setVista] = useState<VistaReporte>('lote');
  const [debugInfo, setDebugInfo] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    setAviso('');
    setDebugInfo('');
    try {
      let ha = HECTAREAS_RANCHO;
      let data: {
        corridas: Corrida[];
        por_lote: Lote[];
        por_talla: TallaRendimientoApi[];
        acumulado: Corrida | null;
      } | null = null;

      try {
        const apiData = await getRendimientosLimon(token);
        ha = apiData.hectareas ?? HECTAREAS_RANCHO;
        const haLote = apiData.hectareas_por_lote ?? HECTAREAS_POR_LOTE;
        setHectareasPorLote(haLote);
        data = {
          corridas: (apiData.corridas || []).map((c) => enrichCorrida(c, ha)),
          por_lote: (apiData.por_lote || []).map((l) => enrichLote(l, haLote)),
          por_talla: apiData.por_talla || apiData.factores_proyeccion?.mix_tallas || [],
          acumulado: apiData.acumulado ? enrichCorrida(apiData.acumulado, ha) : null,
        };
      } catch (err: any) {
        console.warn('rendimientos-limon falló, usando fallback empaques', err);
        setAviso('Usando cálculo local desde empaques (el endpoint de reportes no respondió).');
      }

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
        const computed = computeFromEmpaques(empaques, ha);
        const tallasLocal = computeTallasFromEmpaques(empaques);
        const porLoteRecalc = (computed.por_lote || []).map((l) =>
          enrichLote(l, HECTAREAS_POR_LOTE)
        );
        if (computed.corridas.length > 0) {
          data = { ...computed, por_lote: porLoteRecalc, por_talla: tallasLocal };
          if (!aviso) setAviso('Datos calculados desde registros de empaque.');
        } else if (!data) {
          data = { ...computed, por_lote: porLoteRecalc, por_talla: tallasLocal };
        }
      }

      try {
        const proy = await getProyeccionInventario(token);
        setProyeccion(proy);
      } catch {
        setProyeccion(null);
      }

      setHectareas(ha);
      setCorridas(data?.corridas || []);
      setPorLote(data?.por_lote || []);
      setPorTalla(data?.por_talla || []);
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
  const tabBtn = (id: VistaReporte): CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: vista === id ? 700 : 400,
    background: vista === id ? '#15803d' : '#f1f5f9',
    color: vista === id ? 'white' : '#334155',
  });

  const tallaColors = ['#dcfce7', '#e0f2fe', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5', '#f1f5f9'];

  return (
    <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>📊 Reportes de rendimiento (Limón)</h2>
        <button type="button" onClick={load} style={{ padding: '8px 14px' }}>
          Actualizar
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
        Rancho = <strong>{hectareas} ha</strong> · Por lote = <strong>{hectareasPorLote} ha</strong> (kg/ha
        por lote) · Bin campo = {PESO_BIN_CAMPO_KG} kg · RPC 12 = 12 kg · RPC 18 / cartón = 18 kg · Bin
        jugo = 900 kg · Parrilla RPC = 45 · Cartón = 63 ·{' '}
        <strong>Bins/parrilla = bins campo ÷ parrillas de 1ra</strong> (sin jugo)
      </p>

      {aviso && (
        <p style={{ fontSize: 13, color: '#854d0e', background: '#fef9c3', padding: 10, borderRadius: 8 }}>
          {aviso}
        </p>
      )}
      {debugInfo && (
        <p style={{ fontSize: 12, color: '#64748b' }}>{debugInfo}</p>
      )}

      {/* Acumulado — principales primero */}
      {a && a.bins_campo > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Acumulado — indicadores principales</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ ...cardPrimary, background: '#dcfce7' }}>
              <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>% 1ra calidad</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#14532d' }}>{a.pct_primera}%</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{fmtKg(a.kg_primera)} kg · {fmtNum(a.kg_primera_por_ha)} kg/ha</div>
            </div>
            <div style={{ ...cardPrimary, background: '#fef9c3' }}>
              <div style={{ fontSize: 12, color: '#854d0e', fontWeight: 600 }}>% 2da calidad</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#713f12' }}>{a.pct_segunda}%</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{fmtKg(a.kg_segunda)} kg · {fmtNum(a.kg_segunda_por_ha)} kg/ha</div>
            </div>
            <div style={{ ...cardPrimary, background: '#e0f2fe' }}>
              <div style={{ fontSize: 12, color: '#075985', fontWeight: 600 }}>Bins / parrilla (1ra)</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#0c4a6e' }}>
                {a.bins_por_parrilla != null ? a.bins_por_parrilla : '—'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {a.bins_campo} bins ÷ {a.parrillas_primera ?? '—'} parr. 1ra
              </div>
            </div>
            <div style={{ ...cardPrimary, background: '#f0fdf4' }}>
              <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>Kg totales / ha</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#14532d' }}>
                {fmtNum(a.kg_por_ha)}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {fmtKg(a.kg_salida)} kg ÷ {hectareas} ha
              </div>
            </div>
            <div style={{ ...cardPrimary, background: '#dbeafe' }}>
              <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 600 }}>% 1ra en RPC</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#1e3a8a' }}>
                {fmtNum(a.pct_rpc_de_primera, 1)}%
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {fmtKg(a.kg_rpc ?? 0)} kg · {a.cajas_rpc} cajas
              </div>
            </div>
            <div style={{ ...cardPrimary, background: '#ffedd5' }}>
              <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 600 }}>% 1ra en cartón</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#7c2d12' }}>
                {fmtNum(a.pct_carton_de_primera, 1)}%
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {fmtKg(a.kg_carton ?? 0)} kg · {a.cajas_carton} cajas
              </div>
            </div>
          </div>

          {/* % por talla (principal) */}
          {porTalla.length > 0 && (
            <div style={{ marginTop: 8, marginBottom: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontWeight: 700 }}>% por talla (1ra)</h4>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
                % de cada tamaño sobre kg de 1ra. RPC: 140+ · Cartón: ≤140 (la 140 puede ser ambas).
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {porTalla.map((t, i) => (
                  <div
                    key={t.talla}
                    style={{
                      ...cardPrimary,
                      background: tallaColors[i % tallaColors.length],
                      minWidth: 110,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                      Talla {t.talla}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>{t.pct_de_primera}%</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {fmtKg(t.kg)} kg · {t.cajas} cajas
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {t.pct_de_entrada}% del campo
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4 style={{ margin: '16px 0 8px', color: '#64748b', fontWeight: 600 }}>Detalle (secundario)</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Bins de campo</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{a.bins_campo}</div>
              <div style={{ fontSize: 12 }}>{fmtKg(a.kg_entrada)} kg entrada</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Kg 1ra / 2da / total</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {fmtKg(a.kg_primera)} · {fmtKg(a.kg_segunda)} · {fmtKg(a.kg_salida)}
              </div>
              <div style={{ fontSize: 12 }}>{a.pct_recuperacion}% recuperación</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Parrillas 1ra / jugo / total</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {a.parrillas_primera ?? 0} · {a.parrillas_jugo} · {a.parrillas_total}
              </div>
              <div style={{ fontSize: 12 }}>
                RPC {a.parrillas_rpc} · Cartón {a.parrillas_carton}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Kg/ha 1ra · 2da</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {fmtNum(a.kg_primera_por_ha)} · {fmtNum(a.kg_segunda_por_ha)}
              </div>
              <div style={{ fontSize: 12 }}>sobre {hectareas} ha</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 24, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" style={tabBtn('lote')} onClick={() => setVista('lote')}>
          Por lote
        </button>
        <button type="button" style={tabBtn('corrida')} onClick={() => setVista('corrida')}>
          Por corrida
        </button>
        <button type="button" style={tabBtn('proyeccion')} onClick={() => setVista('proyeccion')}>
          Proyección inventario
        </button>
      </div>

      {vista === 'proyeccion' && (
        <div>
          <h3 style={{ marginTop: 8 }}>Proyección de inventario final</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, maxWidth: 720 }}>
            Usa los bins aún en desverdizado y su <strong>fecha tentativa de salida</strong>{' '}
            (recepción + {DIAS_DESVERDIZADO} días de desverdizado), aplicando el rendimiento
            acumulado (% 1ra / % 2da y mix de tallas). Volúmenes en{' '}
            <strong>parrillas</strong>: RPC = {CAJAS_PARRILLA_RPC} cajas · Cartón ={' '}
            {CAJAS_PARRILLA_CARTON} cajas · sobrantes = parrillas + cajas · 1 bin jugo = 1 parrilla.
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
                    <div style={{ color: '#64748b', marginTop: 4 }}>
                      Por bin de campo: {fmtNum(proyeccion.factores.kg_primera_por_bin, 1)} kg 1ra ·{' '}
                      {fmtNum(proyeccion.factores.kg_segunda_por_bin, 1)} kg 2da
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#b91c1c', marginTop: 6 }}>
                    {proyeccion.factores.nota || 'Falta histórico de empaque.'}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
                <div style={cardPrimary}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Bins en desverdizado</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>
                    {proyeccion.total_bins_desverdizado}
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#dcfce7' }}>
                  <div style={{ fontSize: 12, color: '#166534' }}>Kg 1ra proyectados</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>
                    {fmtKg(proyeccion.total_kg_primera)}
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#fef9c3' }}>
                  <div style={{ fontSize: 12, color: '#854d0e' }}>Kg 2da proyectados</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>
                    {fmtKg(proyeccion.total_kg_segunda)}
                  </div>
                </div>
                <div style={cardPrimary}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Kg salida total</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>
                    {fmtKg(proyeccion.total_kg_salida)}
                  </div>
                </div>
              </div>

              <h4>Por fecha tentativa de salida de desverdizado</h4>
              {proyeccion.por_fecha.length === 0 ? (
                <p style={{ color: '#64748b' }}>
                  No hay bins en desverdizado. Al registrar recepción aparecerán aquí.
                </p>
              ) : (
                <div style={{ overflowX: 'auto', marginBottom: 24 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                        <th style={th}>Fecha salida</th>
                        <th style={th}>Bins</th>
                        <th style={th}>Lotes</th>
                        <th style={th}>kg 1ra</th>
                        <th style={th}>kg 2da</th>
                        <th style={th}>Proyección en parrillas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proyeccion.por_fecha.map((f) => (
                        <tr key={f.fecha} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={td}>
                            <strong>{f.fecha}</strong>
                          </td>
                          <td style={td}>{f.bins}</td>
                          <td style={td}>{f.lotes.join(', ')}</td>
                          <td style={{ ...td, background: '#f0fdf4' }}>{fmtKg(f.kg_primera)}</td>
                          <td style={{ ...td, background: '#fefce8' }}>{fmtKg(f.kg_segunda)}</td>
                          <td style={td}>
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {f.unidades.map((u, i) => (
                                <li key={i} style={{ marginBottom: 4 }}>
                                  {labelPres(u.presentacion)}
                                  {u.talla ? ` #${u.talla}` : ''}:{' '}
                                  <strong style={{ color: '#0c4a6e' }}>
                                    {formatParrillas(u.presentacion, u.cantidad, u.parrillas_label)}
                                  </strong>
                                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                    {fmtNum(u.cantidad, 0)} cajas · {fmtKg(u.kg)} kg
                                    {u.cajas_por_parrilla
                                      ? ` · ${u.cajas_por_parrilla}/parr.`
                                      : ''}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4>Detalle por lote en desverdizado</h4>
              {proyeccion.por_lote.length === 0 ? (
                <p style={{ color: '#64748b' }}>—</p>
              ) : (
                <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                        <th style={th}>Lote</th>
                        <th style={th}>Bins</th>
                        <th style={th}>Recepción</th>
                        <th style={th}>Salida tent.</th>
                        <th style={th}>Estado</th>
                        <th style={th}>kg 1ra</th>
                        <th style={th}>kg 2da</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proyeccion.por_lote.map((l) => (
                        <tr key={`${l.lote}-${l.fecha_tentativa_salida}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={td}>
                            <strong>{l.lote}</strong>
                          </td>
                          <td style={td}>{l.bins}</td>
                          <td style={td}>{l.fecha_recepcion}</td>
                          <td style={td}>{l.fecha_tentativa_salida}</td>
                          <td style={td}>{l.estado}</td>
                          <td style={td}>{fmtKg(l.kg_primera)}</td>
                          <td style={td}>{fmtKg(l.kg_segunda)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {proyeccion.unidades_totales.length > 0 && (
                <>
                  <h4>Total proyectado (si se empaca todo el desverdizado)</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {proyeccion.unidades_totales.map((u, i) => (
                      <div key={i} style={{ ...cardStyle, minWidth: 160 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          {labelPres(u.presentacion)}
                          {u.talla ? ` #${u.talla}` : ''}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#0c4a6e' }}>
                          {formatParrillas(u.presentacion, u.cantidad, u.parrillas_label)}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          {fmtNum(u.cantidad, 0)} cajas · {fmtKg(u.kg)} kg · {u.calidad}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {vista === 'lote' && (
        <>
          <h3 style={{ marginTop: 8 }}>Rendimiento por lote</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
            Principales: % 1ra, % 2da, bins/parrilla (solo 1ra). Kg/ha por lote = kg ÷{' '}
            <strong>{hectareasPorLote} ha</strong> (cada lote = {hectareasPorLote} ha). Multi-lote:
            producción prorrateada por bins.
          </p>
          {porLote.length === 0 ? (
            <div>
              <p style={{ color: '#64748b' }}>
                No hay lotes con empaque usable. Solo cuentan registros con consumos y/o producción.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  minWidth: 920,
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>Lote</th>
                    <th style={thPrimary}>% 1ra</th>
                    <th style={thPrimary}>% 2da</th>
                    <th style={thPrimary}>Bins/parr. 1ra</th>
                    <th style={th}>kg/ha ({hectareasPorLote} ha)</th>
                    <th style={th}>kg 1ra</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>kg total</th>
                    <th style={th}>Bins</th>
                    <th style={th}>Parr. 1ra</th>
                  </tr>
                </thead>
                <tbody>
                  {porLote.map((l) => (
                    <tr key={l.lote} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>
                        <strong>{l.lote}</strong>
                        {l.prorrateado && (
                          <div style={{ fontSize: 11, color: '#b45309' }}>* mezcla</div>
                        )}
                      </td>
                      <td style={{ ...td, background: '#f0fdf4', fontWeight: 700, fontSize: 15 }}>
                        {l.pct_primera}%
                      </td>
                      <td style={{ ...td, background: '#fefce8', fontWeight: 700, fontSize: 15 }}>
                        {l.pct_segunda}%
                      </td>
                      <td style={{ ...td, background: '#e0f2fe', fontWeight: 700, fontSize: 15 }}>
                        {l.bins_por_parrilla != null ? l.bins_por_parrilla : '—'}
                      </td>
                      <td style={td}>
                        <strong>{fmtNum(l.kg_por_ha)}</strong>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>/ {hectareasPorLote} ha</div>
                      </td>
                      <td style={td}>
                        <span style={{ color: '#64748b' }}>{fmtKg(l.kg_primera)}</span>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtNum(l.kg_primera_por_ha)} /ha</div>
                      </td>
                      <td style={td}>
                        <span style={{ color: '#64748b' }}>{fmtKg(l.kg_segunda)}</span>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtNum(l.kg_segunda_por_ha)} /ha</div>
                      </td>
                      <td style={td}>{fmtKg(l.kg_salida)}</td>
                      <td style={td}>{l.bins_campo}</td>
                      <td style={td}>{fmtNum(l.parrillas_primera, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {vista === 'corrida' && (
        <>
          <h3 style={{ marginTop: 8 }}>Por corrida de empaque</h3>
          {corridas.length === 0 ? (
            <p style={{ color: '#64748b' }}>No hay corridas con detalle.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  minWidth: 960,
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>#</th>
                    <th style={th}>Fecha</th>
                    <th style={th}>Lotes</th>
                    <th style={thPrimary}>% 1ra</th>
                    <th style={thPrimary}>% 2da</th>
                    <th style={thPrimary}>Bins/parr. 1ra</th>
                    <th style={th}>kg/ha</th>
                    <th style={th}>kg 1ra</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>kg total</th>
                    <th style={th}>Bins</th>
                    <th style={th}>Parr. 1ra</th>
                  </tr>
                </thead>
                <tbody>
                  {corridas.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>{c.id}</td>
                      <td style={td}>{c.fecha}</td>
                      <td style={td}>{c.lotes_resumen || '—'}</td>
                      <td style={{ ...td, background: '#f0fdf4', fontWeight: 700, fontSize: 15 }}>
                        {c.pct_primera}%
                      </td>
                      <td style={{ ...td, background: '#fefce8', fontWeight: 700, fontSize: 15 }}>
                        {c.pct_segunda}%
                      </td>
                      <td style={{ ...td, background: '#e0f2fe', fontWeight: 700, fontSize: 15 }}>
                        {c.bins_por_parrilla != null ? c.bins_por_parrilla : '—'}
                      </td>
                      <td style={td}>{fmtNum(c.kg_por_ha)}</td>
                      <td style={td}>{fmtKg(c.kg_primera)}</td>
                      <td style={td}>{fmtKg(c.kg_segunda)}</td>
                      <td style={td}>{fmtKg(c.kg_salida)}</td>
                      <td style={td}>
                        {c.bins_campo}
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtKg(c.kg_entrada)} kg</div>
                      </td>
                      <td style={td}>
                        {fmtNum(c.parrillas_primera, 2)}
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          +{c.parrillas_jugo} jugo
                        </div>
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

const thPrimary: CSSProperties = {
  ...th,
  background: '#e2e8f0',
};

const td: CSSProperties = {
  padding: '10px 8px',
  verticalAlign: 'top',
};
