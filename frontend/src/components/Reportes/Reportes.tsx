import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  getRendimientosLimon,
  getProyeccionInventario,
  getEmpaques,
  getDashboard,
  getReporteEmbarques,
  type CorridaRendimientoApi,
  type LoteRendimientoApi,
  type TallaRendimientoApi,
  type ProyeccionInventarioApi,
  type EmbarquesReporteApi,
} from '../../lib/api';
import {
  PESO_BIN_CAMPO_KG,
  HECTAREAS_RANCHO,
  HECTAREAS_POR_LOTE,
} from '../../lib/constants';
import type { DashboardData, EmpaqueRecord } from '../../types';
import EmbarquesReporte from './EmbarquesReporte';
import InventariosReporte from './InventariosReporte';

type Corrida = CorridaRendimientoApi;
type Lote = LoteRendimientoApi;
/** Secciones principales del módulo Reportes */
type SeccionReporte = 'produccion' | 'inventarios' | 'embarques';
/** Sub-vistas de producción */
type VistaReporte = 'lote' | 'corrida';

interface ReportesProps {
  token: string;
}

const KG_PRES: Record<string, number> = {
  rpc_12: 12,
  rpc_18: 18,
  caja_40lbs: 18,
  rpc_granel: 22,
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

/** Tarjeta compacta uniforme (6 indicadores, misma altura) */
const cardPrimary: CSSProperties = {
  ...cardStyle,
  minWidth: 0,
  width: '100%',
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: 2,
  padding: '10px 12px',
};

const cardPrimaryLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.3,
  lineHeight: 1.2,
  textTransform: 'uppercase',
};

const cardPrimaryValue: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: -0.4,
  marginTop: 2,
};

/** Chips de detalle compactos */
const cardStatChip: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(15,23,42,0.06)',
  borderRadius: 6,
  padding: '5px 8px',
};

const cardStatChipLabel: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  marginBottom: 1,
};

const cardStatChipValue: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.15,
  wordBreak: 'break-word',
};

const indicadoresGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gridAutoRows: '1fr',
  gap: 10,
  marginBottom: 12,
  alignItems: 'stretch',
};

function fmtKg(n: number) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Gráfica de pastel SVG: tallas 1ra + 2da (kg y %). Etiquetas dentro de cada gajo. */
function TallaPieChart({
  items,
  colors,
  kgSegunda = 0,
  fmtKg: formatKg,
}: {
  items: TallaRendimientoApi[];
  colors: string[];
  /** Kg de 2da (jugo) a sumar como gajo aparte */
  kgSegunda?: number;
  fmtKg: (n: number) => string;
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const r = 124;
  const holeR = 42;
  const labelR = (holeR + r) / 2 + 4; // radio donde van talla/%

  const COLOR_SEGUNDA = '#f472b6'; // rosita — 2da calidad

  type Slice = {
    key: string;
    label: string; // número de talla o "2da"
    calidad: '1ra' | '2da';
    kg: number;
    cajas: number;
    color: string;
  };

  const raw: Slice[] = items.map((t, i) => ({
    key: `t-${t.talla}`,
    label: String(t.talla),
    calidad: '1ra' as const,
    kg: Number(t.kg) || 0,
    cajas: Number(t.cajas) || 0,
    color: colors[i % colors.length],
  }));

  const kg2 = Math.max(0, Number(kgSegunda) || 0);
  if (kg2 > 0) {
    raw.push({
      key: 'segunda',
      label: '2da',
      calidad: '2da',
      kg: kg2,
      cajas: 0,
      color: COLOR_SEGUNDA,
    });
  }

  const totalKg = raw.reduce((s, t) => s + t.kg, 0);
  const slices = raw
    .map((s) => ({
      ...s,
      pct: totalKg > 0 ? (s.kg / totalKg) * 100 : 0,
    }))
    .filter((s) => s.kg > 0.001 || s.pct > 0.001)
    .sort((a, b) => {
      // 1ra por % desc, 2da al final
      if (a.calidad !== b.calidad) return a.calidad === '2da' ? 1 : -1;
      return b.pct - a.pct;
    });

  const sumPct = slices.reduce((s, x) => s + x.pct, 0) || 1;
  const kgPrimera = slices
    .filter((s) => s.calidad === '1ra')
    .reduce((s, x) => s + x.kg, 0);

  const polar = (angleDeg: number, radius: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  let angle = 0;
  const paths = slices.map((s) => {
    const sweep = (s.pct / sumPct) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const mid = start + sweep / 2;
    if (sweep >= 359.99) {
      return {
        ...s,
        d: `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`,
        mid,
        sweep,
      };
    }
    const large = sweep > 180 ? 1 : 0;
    const p0 = polar(start, r);
    const p1 = polar(end, r);
    const d = `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
    return { ...s, d, mid, sweep };
  });

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        alignItems: 'center',
        padding: '12px 8px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Distribución por talla 1ra y 2da calidad"
      >
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill={p.color}
            stroke="#fff"
            strokeWidth={2.5}
          >
            <title>
              {p.calidad === '2da'
                ? `2da calidad: ${p.pct.toFixed(1)}% · ${formatKg(p.kg)} kg`
                : `Talla ${p.label}: ${p.pct.toFixed(1)}% · ${formatKg(p.kg)} kg · ${p.cajas} cajas`}
            </title>
          </path>
        ))}

        {/* Etiquetas dentro de cada gajo: talla + % */}
        {paths.map((p) => {
          // gajos muy chicos: solo talla si cabe un poco
          if (p.sweep < 12) return null;
          const pt = polar(p.mid, labelR);
          const showPct = p.sweep >= 22;
          const showKg = p.sweep >= 38;
          return (
            <g key={`lbl-${p.key}`}>
              <text
                x={pt.x}
                y={pt.y + (showPct ? -8 : 0)}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: p.calidad === '2da' ? 13 : 16,
                  fontWeight: 800,
                  fill: '#fff',
                  paintOrder: 'stroke',
                  stroke: 'rgba(0,0,0,0.25)',
                  strokeWidth: 2.5,
                }}
              >
                {p.label}
              </text>
              {showPct && (
                <text
                  x={pt.x}
                  y={pt.y + 10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    fill: '#fff',
                    paintOrder: 'stroke',
                    stroke: 'rgba(0,0,0,0.2)',
                    strokeWidth: 2,
                  }}
                >
                  {p.pct.toFixed(1)}%
                </text>
              )}
              {showKg && (
                <text
                  x={pt.x}
                  y={pt.y + 24}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    fill: 'rgba(255,255,255,0.95)',
                    paintOrder: 'stroke',
                    stroke: 'rgba(0,0,0,0.2)',
                    strokeWidth: 1.5,
                  }}
                >
                  {formatKg(p.kg)} kg
                </text>
              )}
            </g>
          );
        })}

        {/* Centro: total salida (1ra+2da) */}
        <circle cx={cx} cy={cy} r={holeR} fill="#fff" />
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          style={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
        >
          Total
        </text>
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          style={{ fontSize: 12, fill: '#0f172a', fontWeight: 800 }}
        >
          {formatKg(totalKg)} kg
        </text>
        <text
          x={cx}
          y={cy + 20}
          textAnchor="middle"
          style={{ fontSize: 9, fill: '#94a3b8', fontWeight: 600 }}
        >
          1ra+2da
        </text>
      </svg>

      <div style={{ flex: '1 1 260px', minWidth: 220 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11 }}>
              <th style={{ padding: '4px 6px' }}>Segmento</th>
              <th style={{ padding: '4px 6px' }}>Cal.</th>
              <th style={{ padding: '4px 6px' }}>%</th>
              <th style={{ padding: '4px 6px' }}>Kg</th>
              <th style={{ padding: '4px 6px' }}>Cajas</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.key} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: '6px', fontWeight: 700 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: s.color,
                      marginRight: 8,
                      verticalAlign: 'middle',
                    }}
                  />
                  {s.calidad === '2da' ? '2da (jugo)' : `Talla ${s.label}`}
                </td>
                <td style={{ padding: '6px', color: s.calidad === '2da' ? '#9d174d' : '#166534' }}>
                  {s.calidad}
                </td>
                <td style={{ padding: '6px', fontWeight: 800 }}>{s.pct.toFixed(1)}%</td>
                <td style={{ padding: '6px', color: '#475569' }}>{formatKg(s.kg)}</td>
                <td style={{ padding: '6px', color: '#475569' }}>
                  {s.calidad === '2da' ? '—' : s.cajas}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f1f5f9' }}>
              <td colSpan={2} style={{ padding: '8px 6px', fontWeight: 700 }}>
                Total
              </td>
              <td style={{ padding: '8px 6px', fontWeight: 800 }}>100%</td>
              <td style={{ padding: '8px 6px', fontWeight: 700 }}>{formatKg(totalKg)}</td>
              <td style={{ padding: '8px 6px' }} />
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: '#64748b', margin: '8px 0 0' }}>
          1ra: {formatKg(kgPrimera)} kg (
          {totalKg ? ((kgPrimera / totalKg) * 100).toFixed(1) : '0'}%) · 2da:{' '}
          {formatKg(kg2)} kg (
          {totalKg ? ((kg2 / totalKg) * 100).toFixed(1) : '0'}%)
        </p>
      </div>
    </div>
  );
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
  const esConversion = (c.tipo_corrida || 'campo') === 'conversion_granel';
  const parrPrimera =
    c.parrillas_primera != null
      ? c.parrillas_primera
      : Math.round(((c.parrillas_rpc || 0) + (c.parrillas_carton || 0)) * 100) / 100;
  const binsPorParrilla =
    !esConversion && parrPrimera > 0 && c.bins_campo > 0
      ? Math.round((c.bins_campo / parrPrimera) * 100) / 100
      : esConversion
        ? null
        : c.bins_por_parrilla ?? null;
  return {
    ...c,
    tipo_corrida: c.tipo_corrida || 'campo',
    parrillas_primera: parrPrimera,
    bins_por_parrilla: binsPorParrilla,
    kg_por_ha: esConversion ? null : c.kg_por_ha ?? kgHa(c.kg_salida, ha),
    kg_primera_por_ha: esConversion ? null : c.kg_primera_por_ha ?? kgHa(c.kg_primera, ha),
    kg_segunda_por_ha: esConversion ? null : c.kg_segunda_por_ha ?? kgHa(c.kg_segunda, ha),
  };
}

/** Suma indicadores de un conjunto de corridas (misma lógica que acumulado API). */
function acumularCorridasSeleccionadas(selected: Corrida[], ha: number): Corrida {
  // Conversiones puras: no suman bins de campo; procesos/campo sí
  const conCampo = selected.filter(
    (c) => (c.tipo_corrida || 'campo') !== 'conversion_granel'
  );
  const base = conCampo.length > 0 ? conCampo : selected;

  const bins = base.reduce((s, c) => s + (c.bins_campo || 0), 0);
  const kg1 = selected.reduce((s, c) => s + (c.kg_primera || 0), 0);
  const kg2 = selected.reduce((s, c) => s + (c.kg_segunda || 0), 0);
  const kgE = base.reduce((s, c) => s + (c.kg_entrada || 0), 0) || bins * PESO_BIN_CAMPO_KG;
  const kgS = kg1 + kg2;
  const kgRpc = selected.reduce((s, c) => s + (c.kg_rpc || 0), 0);
  const kgCarton = selected.reduce((s, c) => s + (c.kg_carton || 0), 0);
  const cRpc = selected.reduce((s, c) => s + (c.cajas_rpc || 0), 0);
  const cCarton = selected.reduce((s, c) => s + (c.cajas_carton || 0), 0);
  const bJugo = selected.reduce((s, c) => s + (c.bins_jugo || 0), 0);
  const pRpc = selected.reduce((s, c) => s + (c.parrillas_rpc || 0), 0);
  const pCarton = selected.reduce((s, c) => s + (c.parrillas_carton || 0), 0);
  const pJugo = selected.reduce((s, c) => s + (c.parrillas_jugo || 0), 0);
  const pPrimera =
    Math.round(
      (selected.reduce((s, c) => s + (c.parrillas_primera ?? 0), 0) || pRpc + pCarton) * 100
    ) / 100;
  // Si parrillas_primera no viene, derivar de cajas
  const pPrimeraFinal =
    pPrimera > 0
      ? pPrimera
      : Math.round((cRpc / CAJAS_PARRILLA_RPC + cCarton / CAJAS_PARRILLA_CARTON) * 100) / 100;
  const pTotal = Math.round((pPrimeraFinal + bJugo) * 100) / 100;
  const binsPorParr =
    pPrimeraFinal > 0 && bins > 0
      ? Math.round((bins / pPrimeraFinal) * 100) / 100
      : null;

  return {
    id: 0,
    fecha: 'seleccion',
    numero_empacador: null,
    tipo_corrida: 'campo',
    bins_campo: bins,
    kg_entrada: Math.round(kgE * 100) / 100,
    kg_primera: Math.round(kg1 * 100) / 100,
    kg_segunda: Math.round(kg2 * 100) / 100,
    kg_salida: Math.round(kgS * 100) / 100,
    pct_primera: kgE ? Math.round((kg1 / kgE) * 10000) / 100 : 0,
    pct_segunda: kgE ? Math.round((kg2 / kgE) * 10000) / 100 : 0,
    pct_recuperacion: kgE ? Math.round((kgS / kgE) * 10000) / 100 : 0,
    kg_rpc: Math.round(kgRpc * 100) / 100,
    kg_carton: Math.round(kgCarton * 100) / 100,
    pct_rpc_de_primera: kg1 ? Math.round((kgRpc / kg1) * 10000) / 100 : 0,
    pct_carton_de_primera: kg1 ? Math.round((kgCarton / kg1) * 10000) / 100 : 0,
    cajas_rpc: cRpc,
    cajas_carton: cCarton,
    bins_jugo: bJugo,
    parrillas_rpc: Math.round(pRpc * 100) / 100,
    parrillas_carton: Math.round(pCarton * 100) / 100,
    parrillas_jugo: pJugo || bJugo,
    parrillas_primera: pPrimeraFinal,
    parrillas_total: pTotal,
    bins_por_parrilla: binsPorParr,
    kg_por_ha: kgHa(kgS, ha),
    kg_primera_por_ha: kgHa(kg1, ha),
    kg_segunda_por_ha: kgHa(kg2, ha),
    lotes_resumen: `${selected.length} corrida(s) seleccionada(s)`,
  };
}

function resumenConsumosGranel(
  cg: Array<{
    lote?: string | null;
    talla?: string | number | null;
    cantidad?: number;
    fecha_empaque?: string | null;
  }>
): string {
  return cg
    .filter((g) => (Number(g.cantidad) || 0) > 0)
    .map((g) => {
      const lote = String(g.lote || 'SIN_LOTE').trim();
      const talla =
        g.talla != null && String(g.talla).trim() !== '' ? `#${g.talla}` : '';
      const fe = g.fecha_empaque ? `@${g.fecha_empaque}` : '';
      return `granel ${lote}${talla}${fe}:${g.cantidad}`;
    })
    .join(', ');
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

    const esConversion = det?.tipo === 'conversion_rpc_granel';
    let consumos = det?.consumos || [];
    let produccion = det?.produccion || [];
    const consumosGranel = det?.consumos_granel || [];

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
    if (esConversion) {
      if (consumosGranel.length === 0 && produccion.length === 0) continue;
    } else if (consumos.length === 0 && produccion.length === 0) {
      continue;
    }

    let kg1 = 0;
    let kg2 = 0;
    let kgRpc = 0;
    let kgCarton = 0;
    let kgGranel = 0;
    let cajasRpc = 0;
    let cajasCarton = 0;
    let binsJugo = 0;
    let rpcGranelProducido = 0;
    for (const p of produccion) {
      const cant = Number(p.cantidad) || 0;
      if (cant <= 0) continue;
      // Conversión: producción es final; no contar granel residual en prod
      if (esConversion && p.presentacion === 'rpc_granel') continue;
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
      } else if (p.presentacion === 'rpc_granel') {
        // WIP 1ra del día de campo (para usar al día siguiente)
        kg1 += kg;
        kgGranel += kg;
        rpcGranelProducido += cant;
      } else {
        kg1 += kg;
      }
    }

    const rpcGranelUsado = esConversion
      ? consumosGranel.reduce((s, g) => s + (Number(g.cantidad) || 0), 0)
      : 0;
    const binsCampo = esConversion
      ? 0
      : consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0);
    const kgEntrada = esConversion
      ? rpcGranelUsado * (KG_PRES.rpc_granel || 22)
      : binsCampo * PESO_BIN_CAMPO_KG;
    const kgSalida = kg1 + kg2;
    const parrRpc = cajasRpc ? cajasRpc / CAJAS_PARRILLA_RPC : 0;
    const parrCarton = cajasCarton ? cajasCarton / CAJAS_PARRILLA_CARTON : 0;
    const parrPrimera = Math.round((parrRpc + parrCarton) * 100) / 100;
    const parrTotal = Math.round((parrPrimera + binsJugo) * 100) / 100;
    const lotesResumen = esConversion
      ? det?.lotes_resumen || resumenConsumosGranel(consumosGranel) || 'conversión granel'
      : det?.lotes_resumen ||
        consumos.map((c) => `${c.lote}:${c.bins}`).join(', ') ||
        e.lote_desverdizado ||
        '';

    corridas.push(
      enrichCorrida(
        {
          id: e.id,
          fecha: e.fecha,
          numero_empacador: e.numero_empacador,
          tipo_corrida: esConversion ? 'conversion_granel' : 'campo',
          bins_campo: binsCampo,
          rpc_granel_usado: rpcGranelUsado,
          rpc_granel_producido: rpcGranelProducido,
          kg_entrada: kgEntrada,
          kg_primera: Math.round(kg1 * 100) / 100,
          kg_segunda: Math.round(kg2 * 100) / 100,
          kg_salida: Math.round(kgSalida * 100) / 100,
          pct_primera: kgEntrada ? Math.round((kg1 / kgEntrada) * 10000) / 100 : 0,
          pct_segunda: kgEntrada ? Math.round((kg2 / kgEntrada) * 10000) / 100 : 0,
          pct_recuperacion: kgEntrada ? Math.round((kgSalida / kgEntrada) * 10000) / 100 : 0,
          kg_rpc: Math.round(kgRpc * 100) / 100,
          kg_carton: Math.round(kgCarton * 100) / 100,
          kg_granel: Math.round(kgGranel * 100) / 100,
          pct_rpc_de_primera: kg1 ? Math.round((kgRpc / kg1) * 10000) / 100 : 0,
          pct_carton_de_primera: kg1 ? Math.round((kgCarton / kg1) * 10000) / 100 : 0,
          pct_granel_de_primera: kg1 ? Math.round((kgGranel / kg1) * 10000) / 100 : 0,
          cajas_rpc: cajasRpc,
          cajas_carton: cajasCarton,
          bins_jugo: binsJugo,
          parrillas_rpc: Math.round(parrRpc * 100) / 100,
          parrillas_carton: Math.round(parrCarton * 100) / 100,
          parrillas_jugo: binsJugo,
          parrillas_primera: parrPrimera,
          parrillas_total: parrTotal,
          bins_por_parrilla:
            !esConversion && parrPrimera > 0 && binsCampo > 0
              ? Math.round((binsCampo / parrPrimera) * 100) / 100
              : null,
          lotes_resumen: lotesResumen,
        },
        ha
      )
    );

    // Por lote solo acumula corridas de campo (no conversiones)
    if (esConversion) continue;

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

  // Acumulado rancho: solo corridas de campo
  const corridasCampo = corridas.filter(
    (c) => (c.tipo_corrida || 'campo') === 'campo'
  );
  const bins = corridasCampo.reduce((s, c) => s + c.bins_campo, 0);
  const kg1 = corridasCampo.reduce((s, c) => s + c.kg_primera, 0);
  const kg2 = corridasCampo.reduce((s, c) => s + c.kg_segunda, 0);
  const kgRpcT = corridasCampo.reduce((s, c) => s + (c.kg_rpc || 0), 0);
  const kgCartonT = corridasCampo.reduce((s, c) => s + (c.kg_carton || 0), 0);
  const kgE = bins * PESO_BIN_CAMPO_KG;
  const kgS = kg1 + kg2;
  const cRpc = corridasCampo.reduce((s, c) => s + c.cajas_rpc, 0);
  const cCarton = corridasCampo.reduce((s, c) => s + c.cajas_carton, 0);
  const bJugo = corridasCampo.reduce((s, c) => s + c.bins_jugo, 0);
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
      tipo_corrida: 'campo',
      lotes_resumen: `${corridasCampo.length} corridas de campo`,
    },
    ha
  );

  return { corridas, por_lote, acumulado };
}

/**
 * Mix de tallas 1ra + kg 2da a partir de empaques.
 * Incluye conversiones granel→final salvo soloCampo.
 * Omite rpc_granel (WIP) del mix de 1ra.
 */
function computeTallasYSegundaFromEmpaques(
  empaques: EmpaqueRecord[],
  opts?: { soloCampo?: boolean }
): { porTalla: TallaRendimientoApi[]; kgSegunda: number; kgPrimera: number } {
  const kgT: Record<string, number> = {};
  const cajasT: Record<string, number> = {};
  let binsTotal = 0;
  let kg1 = 0;
  let kg2 = 0;
  for (const e of empaques) {
    const det = parseDetalle(e.detalle_corrida as any);
    if (det?.anulado) continue;
    const esConv = det?.tipo === 'conversion_rpc_granel';
    if (opts?.soloCampo && esConv) continue;
    const consumos = det?.consumos || [];
    const produccion = det?.produccion || [];
    if (!esConv) {
      binsTotal += consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0);
    }
    for (const p of produccion) {
      const cant = Number(p.cantidad) || 0;
      if (cant <= 0) continue;
      const pres = String(p.presentacion || '');
      if (pres === 'bins_jugo') {
        kg2 += (KG_PRES.bins_jugo || 900) * cant;
        continue;
      }
      if (pres === 'rpc_granel') continue;
      if (!p.talla) continue;
      const talla = String(p.talla);
      const kg = (KG_PRES[pres] || 0) * cant;
      kgT[talla] = (kgT[talla] || 0) + kg;
      cajasT[talla] = (cajasT[talla] || 0) + cant;
      kg1 += kg;
    }
  }
  const kgE = binsTotal * PESO_BIN_CAMPO_KG;
  const porTalla = Object.keys(kgT)
    .sort((a, b) => Number(a) - Number(b))
    .map((t) => ({
      talla: t,
      cajas: cajasT[t] || 0,
      kg: Math.round(kgT[t] * 100) / 100,
      pct_de_primera: kg1 ? Math.round((kgT[t] / kg1) * 10000) / 100 : 0,
      pct_de_entrada: kgE ? Math.round((kgT[t] / kgE) * 10000) / 100 : 0,
      parrillas: Math.round(((cajasT[t] || 0) / CAJAS_PARRILLA_RPC) * 100) / 100,
    }));
  return {
    porTalla,
    kgSegunda: Math.round(kg2 * 100) / 100,
    kgPrimera: Math.round(kg1 * 100) / 100,
  };
}

/** % por talla desde empaques (fallback cliente, solo corridas de campo) */
function computeTallasFromEmpaques(empaques: EmpaqueRecord[]): TallaRendimientoApi[] {
  return computeTallasYSegundaFromEmpaques(empaques, { soloCampo: true }).porTalla;
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
  const [seccion, setSeccion] = useState<SeccionReporte>('produccion');
  // Por corrida: procesos fusionados (campo + conversión del granel)
  const [vista, setVista] = useState<VistaReporte>('lote');
  const [debugInfo, setDebugInfo] = useState('');
  /** id de proceso expandido para ver pasos (campo + conversiones) */
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [reporteEmbarques, setReporteEmbarques] = useState<EmbarquesReporteApi | null>(null);
  /** Empaques limón (para recalcular gráfica al filtrar corridas) */
  const [empaquesLimon, setEmpaquesLimon] = useState<EmpaqueRecord[]>([]);
  /** Fuente de la gráfica de pastel: acumulado total (default) o corridas elegidas */
  const [graficaModo, setGraficaModo] = useState<'acumulado' | 'seleccion'>('acumulado');
  const [corridasGraficaIds, setCorridasGraficaIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

      // Siempre cargar empaques (gráfica filtrable + fallback)
      let empaquesAll: EmpaqueRecord[] = [];
      try {
        empaquesAll = await getEmpaques(token);
      } catch {
        empaquesAll = [];
      }
      const limonAll = empaquesAll.filter((e) =>
        String(e.producto || '').toLowerCase().includes('limon')
      );
      setEmpaquesLimon(limonAll);

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
        const limon = limonAll;
        const conDetalle = limon.filter((e) => {
          const d = parseDetalle(e.detalle_corrida as any);
          return Boolean(
            d?.consumos?.length ||
              d?.consumos_granel?.length ||
              d?.produccion?.length ||
              d?.tipo === 'conversion_rpc_granel' ||
              (e.bins_desverdizado_usados || 0) > 0
          );
        });
        setDebugInfo(
          `Empaques limón: ${limon.length} · Con datos de corrida: ${conDetalle.length}`
        );
        const computed = computeFromEmpaques(empaquesAll, ha);
        const tallasLocal = computeTallasFromEmpaques(empaquesAll);
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

      try {
        const dash = await getDashboard(token);
        setDashboard(dash);
      } catch {
        setDashboard(null);
      }

      try {
        const embRep = await getReporteEmbarques(token);
        setReporteEmbarques(embRep);
      } catch {
        setReporteEmbarques(null);
      }

      setHectareas(ha);
      setCorridas(data?.corridas || []);
      setPorLote(data?.por_lote || []);
      setPorTalla(data?.por_talla || []);
      setAcumulado(data?.acumulado || null);
      // Mantener selección de corridas que sigan existiendo
      const alive = new Set((data?.corridas || []).map((c) => c.id));
      setCorridasGraficaIds((prev) => new Set([...prev].filter((id) => alive.has(id))));
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

  /** Corridas elegibles para graficar — hooks SIEMPRE antes de returns condicionales */
  const corridasParaGrafica = useMemo(
    () =>
      corridas.filter((c) => {
        return (c.kg_primera || 0) > 0 || (c.kg_segunda || 0) > 0 || (c.bins_campo || 0) > 0;
      }),
    [corridas]
  );

  /** Corridas marcadas para vista filtrada */
  const corridasSeleccionadas = useMemo(
    () => corridasParaGrafica.filter((c) => corridasGraficaIds.has(c.id)),
    [corridasParaGrafica, corridasGraficaIds]
  );

  /**
   * Resumen de indicadores: total del rancho o solo las corridas elegidas.
   * Misma fuente que la gráfica de pastel.
   */
  const resumenVista = useMemo((): Corrida | null => {
    if (graficaModo === 'acumulado') {
      return acumulado;
    }
    if (corridasSeleccionadas.length === 0) {
      return null;
    }
    return acumularCorridasSeleccionadas(corridasSeleccionadas, hectareas);
  }, [graficaModo, acumulado, corridasSeleccionadas, hectareas]);

  const graficaData = useMemo(() => {
    if (graficaModo === 'acumulado') {
      return {
        porTalla,
        kgSegunda: acumulado?.kg_segunda ?? 0,
        titulo: 'Distribución por talla (1ra) y 2da calidad — acumulado total',
        subtitulo:
          'Todas las corridas. Cada gajo = talla o 2da; % sobre kg empacados (1ra+2da).',
      };
    }
    if (corridasSeleccionadas.length === 0) {
      return {
        porTalla: [] as TallaRendimientoApi[],
        kgSegunda: 0,
        titulo: 'Distribución por talla — corridas seleccionadas',
        subtitulo: 'Selecciona una o más corridas abajo para graficar y ver el resumen.',
        vacio: true as const,
      };
    }
    const empIds = new Set<number>();
    for (const c of corridasSeleccionadas) {
      const ids = c.ids_empaques?.length ? c.ids_empaques : [c.id];
      for (const id of ids) empIds.add(id);
    }
    const subset = empaquesLimon.filter((e) => empIds.has(e.id));
    const computed = computeTallasYSegundaFromEmpaques(subset, { soloCampo: false });
    let porTallaSel = computed.porTalla;
    let kg2 = computed.kgSegunda;
    if (subset.length === 0) {
      kg2 = corridasSeleccionadas.reduce((s, c) => s + (c.kg_segunda || 0), 0);
      porTallaSel = [];
    } else if (kg2 === 0) {
      const kg2Corr = corridasSeleccionadas.reduce((s, c) => s + (c.kg_segunda || 0), 0);
      if (kg2Corr > 0) kg2 = kg2Corr;
    }
    // Preferir kg 2da del resumen de corridas si el detalle de empaque difiere poco
    if (resumenVista && (resumenVista.kg_segunda || 0) > 0 && kg2 === 0) {
      kg2 = resumenVista.kg_segunda;
    }
    const labels = corridasSeleccionadas
      .map((c) => `#${c.id} ${c.fecha}`)
      .slice(0, 6)
      .join(', ');
    const extra =
      corridasSeleccionadas.length > 6 ? ` +${corridasSeleccionadas.length - 6}` : '';
    return {
      porTalla: porTallaSel,
      kgSegunda: kg2,
      titulo: `Distribución por talla — ${corridasSeleccionadas.length} corrida(s)`,
      subtitulo: `Selección: ${labels}${extra}. Resumen e indicadores solo de esas corridas.`,
    };
  }, [
    graficaModo,
    porTalla,
    acumulado?.kg_segunda,
    corridasSeleccionadas,
    empaquesLimon,
    resumenVista,
  ]);

  const toggleCorridaGrafica = (id: number) => {
    setCorridasGraficaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCorridasGrafica = () => {
    setCorridasGraficaIds(new Set(corridasParaGrafica.map((c) => c.id)));
  };

  const clearCorridasGrafica = () => setCorridasGraficaIds(new Set());

  if (loading) {
    return (
      <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
        <h2>📊 Reportes</h2>
        <p style={{ color: '#64748b' }}>Cargando… (si la API estaba dormida puede tardar ~30s)</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
        <h2>📊 Reportes</h2>
        <p style={{ color: '#dc2626' }}>{error}</p>
        <button type="button" onClick={load} style={{ padding: '8px 16px' }}>
          Reintentar
        </button>
      </div>
    );
  }

  /** Indicadores visibles: total o selección */
  const a = resumenVista;
  const modoSeleccion = graficaModo === 'seleccion';
  const sinSeleccion = modoSeleccion && corridasSeleccionadas.length === 0;

  const seccionBtn = (id: SeccionReporte): CSSProperties => ({
    padding: '10px 18px',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: seccion === id ? 700 : 500,
    background: seccion === id ? '#0f172a' : '#f1f5f9',
    color: seccion === id ? 'white' : '#334155',
    fontSize: 14,
  });
  const tabBtn = (id: VistaReporte): CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: vista === id ? 700 : 400,
    background: vista === id ? '#15803d' : '#f1f5f9',
    color: vista === id ? 'white' : '#334155',
  });

  /** Colores vivos para pastel de tallas (1ra) */
  const tallaPieColors = [
    '#15803d',
    '#0284c7',
    '#ca8a04',
    '#db2777',
    '#7c3aed',
    '#ea580c',
    '#0f766e',
    '#4f46e5',
  ];

  return (
    <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>📊 Reportes</h2>
        <button type="button" onClick={load} style={{ padding: '8px 14px' }}>
          Actualizar todo
        </button>
      </div>

      {/* Pestañas principales: Producción | Inventarios | Embarques */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" style={seccionBtn('produccion')} onClick={() => setSeccion('produccion')}>
          Producción / resultados
        </button>
        <button type="button" style={seccionBtn('inventarios')} onClick={() => setSeccion('inventarios')}>
          Inventarios
        </button>
        <button type="button" style={seccionBtn('embarques')} onClick={() => setSeccion('embarques')}>
          Embarques
          {reporteEmbarques && reporteEmbarques.total_embarques > 0
            ? ` (${reporteEmbarques.total_embarques})`
            : ''}
        </button>
      </div>

      {seccion === 'inventarios' && (
        <div style={{ marginTop: 12 }}>
          <InventariosReporte
            data={dashboard}
            proyeccion={proyeccion}
            onRefresh={load}
            empaquesLimon={empaquesLimon}
            corridas={corridas}
          />
        </div>
      )}

      {seccion === 'embarques' && (
        <div style={{ marginTop: 12 }}>
          <EmbarquesReporte data={reporteEmbarques} onRefresh={load} />
        </div>
      )}

      {seccion === 'produccion' && (
      <>
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

      {/* Selector de alcance: total o corridas (afecta resumen + gráfica) */}
      {(acumulado || corridasParaGrafica.length > 0) && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0, flex: '1 1 auto' }}>
              {modoSeleccion
                ? sinSeleccion
                  ? 'Selección de corridas'
                  : `Resumen — ${corridasSeleccionadas.length} corrida(s)`
                : 'Acumulado — indicadores principales'}
            </h3>
            <div
              style={{
                display: 'inline-flex',
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid #cbd5e1',
              }}
            >
              <button
                type="button"
                onClick={() => setGraficaModo('acumulado')}
                style={{
                  padding: '8px 14px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: graficaModo === 'acumulado' ? 700 : 500,
                  background: graficaModo === 'acumulado' ? '#0f172a' : '#fff',
                  color: graficaModo === 'acumulado' ? '#fff' : '#334155',
                  fontSize: 13,
                }}
              >
                Acumulado total
              </button>
              <button
                type="button"
                onClick={() => setGraficaModo('seleccion')}
                style={{
                  padding: '8px 14px',
                  border: 'none',
                  borderLeft: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontWeight: graficaModo === 'seleccion' ? 700 : 500,
                  background: graficaModo === 'seleccion' ? '#0f172a' : '#fff',
                  color: graficaModo === 'seleccion' ? '#fff' : '#334155',
                  fontSize: 13,
                }}
              >
                Elegir corridas
              </button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 12 }}>
            {modoSeleccion
              ? 'El resumen (% 1ra, kg/ha, parrillas) y la gráfica usan solo las corridas marcadas.'
              : 'Resumen y gráfica del total del rancho (todas las corridas).'}
          </p>

          {modoSeleccion && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>Corridas a graficar</strong>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {corridasGraficaIds.size} de {corridasParaGrafica.length} seleccionada(s)
                    </span>
                    <button
                      type="button"
                      onClick={selectAllCorridasGrafica}
                      style={{
                        marginLeft: 'auto',
                        padding: '5px 10px',
                        fontSize: 12,
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      onClick={clearCorridasGrafica}
                      style={{
                        padding: '5px 10px',
                        fontSize: 12,
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      Ninguna
                    </button>
                  </div>
                  {corridasParaGrafica.length === 0 ? (
                    <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                      No hay corridas con datos.
                    </p>
                  ) : (
                    <div
                      style={{
                        maxHeight: 320,
                        overflowY: 'auto',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                      }}
                    >
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: 13,
                          minWidth: 560,
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              background: '#f1f5f9',
                              textAlign: 'left',
                              position: 'sticky',
                              top: 0,
                              zIndex: 1,
                            }}
                          >
                            <th style={{ ...th, width: 40, textAlign: 'center' }}></th>
                            <th style={{ ...th, textAlign: 'center' }}>Fecha proceso</th>
                            <th style={{ ...th, textAlign: 'center' }}>Bins campo</th>
                            <th style={{ ...th, textAlign: 'center' }}>RPC (cajas)</th>
                            <th style={{ ...th, textAlign: 'center' }}>Cartón (cajas)</th>
                            <th style={{ ...th, textAlign: 'center' }}>Bins 2da</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...corridasParaGrafica]
                            .sort((x, y) =>
                              String(y.fecha || '').localeCompare(String(x.fecha || ''))
                            )
                            .map((c) => {
                              const checked = corridasGraficaIds.has(c.id);
                              return (
                                <tr
                                  key={c.id}
                                  onClick={() => toggleCorridaGrafica(c.id)}
                                  style={{
                                    borderBottom: '1px solid #f1f5f9',
                                    background: checked ? '#f0fdf4' : '#fff',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <td
                                    style={{ ...td, width: 40, textAlign: 'center' }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleCorridaGrafica(c.id)}
                                      title={`Corrida #${c.id}`}
                                    />
                                  </td>
                                  <td style={{ ...td, textAlign: 'center' }}>
                                    <strong>{c.fecha || '—'}</strong>
                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>#{c.id}</div>
                                  </td>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>
                                    {c.bins_campo ?? 0}
                                  </td>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>
                                    {c.cajas_rpc ?? 0}
                                  </td>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>
                                    {c.cajas_carton ?? 0}
                                  </td>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>
                                    {c.bins_jugo ?? 0}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

          {/* Indicadores principales (total o solo corridas elegidas) */}
          {sinSeleccion ? (
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Marca una o más corridas para ver el resumen (% 1ra, kg/ha, parrillas) y la gráfica.
            </p>
          ) : a ? (
            <>
              {/* 3×2 compacto: los 6 del mismo tamaño */}
              <div style={indicadoresGrid}>
                <div style={{ ...cardPrimary, background: '#dcfce7' }}>
                  <div style={{ ...cardPrimaryLabel, color: '#166534' }}>1ra calidad</div>
                  <div style={{ ...cardPrimaryValue, color: '#14532d' }}>
                    {a.pct_primera}
                    <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 1 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Kg</div>
                      <div style={{ ...cardStatChipValue, color: '#14532d' }}>
                        {fmtKg(a.kg_primera)}
                      </div>
                    </div>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Kg/ha</div>
                      <div style={{ ...cardStatChipValue, color: '#14532d' }}>
                        {fmtNum(a.kg_primera_por_ha)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#fef9c3' }}>
                  <div style={{ ...cardPrimaryLabel, color: '#854d0e' }}>2da · jugo</div>
                  <div style={{ ...cardPrimaryValue, color: '#713f12' }}>
                    {a.pct_segunda}
                    <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 1 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Kg</div>
                      <div style={{ ...cardStatChipValue, color: '#713f12' }}>
                        {fmtKg(a.kg_segunda)}
                      </div>
                    </div>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Kg/ha</div>
                      <div style={{ ...cardStatChipValue, color: '#713f12' }}>
                        {fmtNum(a.kg_segunda_por_ha)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#f0fdf4' }}>
                  <div style={{ ...cardPrimaryLabel, color: '#166534' }}>Ton / ha</div>
                  <div style={{ ...cardPrimaryValue, color: '#14532d' }}>
                    {(() => {
                      const kgHaVal =
                        a.kg_por_ha != null && a.kg_por_ha !== undefined
                          ? Number(a.kg_por_ha)
                          : hectareas
                            ? a.kg_salida / hectareas
                            : 0;
                      const tonHa = kgHaVal / 1000;
                      return Number.isFinite(tonHa) ? tonHa.toFixed(1) : '—';
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>1ra</div>
                      <div style={{ ...cardStatChipValue, color: '#14532d' }}>
                        {fmtNum(a.pct_primera, 1)}%
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#64748b' }}>
                          {' '}
                          ({fmtKg(a.kg_primera)})
                        </span>
                      </div>
                    </div>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Jugo</div>
                      <div style={{ ...cardStatChipValue, color: '#854d0e' }}>
                        {fmtNum(a.pct_segunda, 1)}%
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#64748b' }}>
                          {' '}
                          ({fmtKg(a.kg_segunda)})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#e0f2fe' }}>
                  <div style={{ ...cardPrimaryLabel, color: '#075985' }}>Bins / parrilla</div>
                  <div style={{ ...cardPrimaryValue, color: '#0c4a6e' }}>
                    {a.bins_por_parrilla != null ? a.bins_por_parrilla : '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Bins</div>
                      <div style={{ ...cardStatChipValue, color: '#0c4a6e' }}>{a.bins_campo}</div>
                    </div>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Parr. 1ra</div>
                      <div style={{ ...cardStatChipValue, color: '#0c4a6e' }}>
                        {a.parrillas_primera ?? '—'}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#dbeafe' }}>
                  <div style={{ ...cardPrimaryLabel, color: '#1e40af' }}>% 1ra en RPC</div>
                  <div style={{ ...cardPrimaryValue, color: '#1e3a8a' }}>
                    {fmtNum(a.pct_rpc_de_primera, 1)}
                    <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 1 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Kg</div>
                      <div style={{ ...cardStatChipValue, color: '#1e3a8a' }}>
                        {fmtKg(a.kg_rpc ?? 0)}
                      </div>
                    </div>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Cajas</div>
                      <div style={{ ...cardStatChipValue, color: '#1e3a8a' }}>{a.cajas_rpc}</div>
                    </div>
                  </div>
                </div>
                <div style={{ ...cardPrimary, background: '#ffedd5' }}>
                  <div style={{ ...cardPrimaryLabel, color: '#9a3412' }}>% 1ra en cartón</div>
                  <div style={{ ...cardPrimaryValue, color: '#7c2d12' }}>
                    {fmtNum(a.pct_carton_de_primera, 1)}
                    <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 1 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Kg</div>
                      <div style={{ ...cardStatChipValue, color: '#7c2d12' }}>
                        {fmtKg(a.kg_carton ?? 0)}
                      </div>
                    </div>
                    <div style={cardStatChip}>
                      <div style={cardStatChipLabel}>Cajas</div>
                      <div style={{ ...cardStatChipValue, color: '#7c2d12' }}>{a.cajas_carton}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Gráfica de pastel alineada al mismo alcance */}
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontWeight: 700 }}>{graficaData.titulo}</h4>
                <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
                  {graficaData.subtitulo} Segmento rosado = 2da (jugo).
                </p>
                {modoSeleccion &&
                corridasSeleccionadas.length > 0 &&
                graficaData.porTalla.length === 0 &&
                graficaData.kgSegunda <= 0 ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: '#854d0e',
                      background: '#fef9c3',
                      padding: 10,
                      borderRadius: 8,
                    }}
                  >
                    Las corridas seleccionadas no tienen desglose de tallas en empaque. El resumen
                    de arriba sí refleja esas corridas.
                  </p>
                ) : (
                  (graficaData.porTalla.length > 0 || graficaData.kgSegunda > 0) && (
                    <TallaPieChart
                      items={graficaData.porTalla}
                      colors={tallaPieColors}
                      kgSegunda={graficaData.kgSegunda}
                      fmtKg={fmtKg}
                    />
                  )
                )}
              </div>

              <h4 style={{ margin: '16px 0 8px', color: '#64748b', fontWeight: 600 }}>
                Detalle (secundario)
                {modoSeleccion ? ' — selección' : ''}
              </h4>
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
            </>
          ) : null}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 24, marginBottom: 12, flexWrap: 'wrap' }}>
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
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, maxWidth: 920 }}>
            Cada fila es un <strong>proceso completo</strong>: día de campo + conversiones del
            granel residual. El <strong>kg 1ra</strong> solo cuenta producto final (RPC/cartón), no
            el WIP a granel. Haz <strong>clic en la fila</strong> para ver el desglose (cuánto salió
            de bins, cuánto granel quedó y cómo se convirtió después).
          </p>
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
                    <th style={th}></th>
                    <th style={th}>#</th>
                    <th style={th}>Tipo</th>
                    <th style={th}>Fecha</th>
                    <th style={th}>Origen / lotes</th>
                    <th style={thPrimary}>% 1ra</th>
                    <th style={thPrimary}>% 2da</th>
                    <th style={thPrimary}>Bins/parr.</th>
                    <th style={th}>kg 1ra final</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>kg total</th>
                    <th style={th}>Entrada</th>
                    <th style={th}>Parr. final</th>
                  </tr>
                </thead>
                <tbody>
                  {corridas.map((c) => {
                    const tipo = c.tipo_corrida || 'campo';
                    const esProc = tipo === 'proceso';
                    const esConv = tipo === 'conversion_granel';
                    const open = expandidos.has(c.id);
                    const pasos = c.pasos || [];
                    const puedeExpandir = pasos.length > 0;
                    return (
                      <Fragment key={c.id}>
                        <tr
                          onClick={() => puedeExpandir && toggleExpand(c.id)}
                          style={{
                            borderBottom: open ? 'none' : '1px solid #e2e8f0',
                            background: esProc
                              ? '#eef2ff'
                              : esConv
                                ? '#f5f3ff'
                                : open
                                  ? '#f8fafc'
                                  : undefined,
                            cursor: puedeExpandir ? 'pointer' : 'default',
                          }}
                          title={puedeExpandir ? 'Clic para ver desglose del proceso' : undefined}
                        >
                          <td style={{ ...td, width: 28, color: '#64748b', fontWeight: 700 }}>
                            {puedeExpandir ? (open ? '▾' : '▸') : ''}
                          </td>
                          <td style={td}>
                            {c.id}
                            {(c.ids_empaques || []).length > 1 && (
                              <div style={{ fontSize: 10, color: '#6366f1' }}>
                                emp. {(c.ids_empaques || []).join('+')}
                              </div>
                            )}
                          </td>
                          <td style={td}>
                            {esProc ? (
                              <span style={badgeProc}>Proceso</span>
                            ) : esConv ? (
                              <span style={badgeConv}>Granel→final</span>
                            ) : (
                              <span style={badgeCampo}>Campo</span>
                            )}
                          </td>
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
                          <td style={td}>
                            <strong>{fmtKg(c.kg_primera)}</strong>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                              RPC {fmtKg(c.kg_rpc || 0)} · cartón {fmtKg(c.kg_carton || 0)}
                            </div>
                            {(c.kg_granel || 0) > 0 && (
                              <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 2 }}>
                                WIP granel {fmtKg(c.kg_granel || 0)}
                                {(c.rpc_granel_producido || 0) > 0
                                  ? ` (${c.rpc_granel_producido} RPC)`
                                  : ''}
                                {(c.kg_granel_pendiente || 0) > 0
                                  ? ` · pendiente ${fmtKg(c.kg_granel_pendiente || 0)}`
                                  : c.rpc_granel_usado
                                    ? ' · convertido'
                                    : ''}
                              </div>
                            )}
                          </td>
                          <td style={td}>{fmtKg(c.kg_segunda)}</td>
                          <td style={td}>{fmtKg(c.kg_salida)}</td>
                          <td style={td}>
                            {esConv ? (
                              <>
                                {c.rpc_granel_usado ?? 0} RPC granel
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                  {fmtKg(c.kg_entrada)} kg
                                </div>
                              </>
                            ) : (
                              <>
                                {c.bins_campo} bins
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                  {fmtKg(c.kg_entrada)} kg
                                </div>
                              </>
                            )}
                          </td>
                          <td style={td}>
                            {fmtNum(c.parrillas_primera, 2)}
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              +{c.parrillas_jugo} jugo
                            </div>
                          </td>
                        </tr>
                        {open && pasos.length > 0 && (
                          <tr>
                            <td
                              colSpan={13}
                              style={{
                                padding: '0 12px 14px 36px',
                                background: '#f8fafc',
                                borderBottom: '1px solid #e2e8f0',
                              }}
                            >
                              <div
                                style={{
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 10,
                                  padding: 14,
                                  background: 'white',
                                  marginTop: 4,
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 700,
                                    marginBottom: 10,
                                    color: '#334155',
                                  }}
                                >
                                  Desglose del proceso
                                </div>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 10,
                                  }}
                                >
                                  {pasos.map((p, idx) => {
                                    const esPasoConv = p.tipo === 'conversion_granel';
                                    return (
                                      <div
                                        key={`${p.empaque_id}-${idx}`}
                                        style={{
                                          borderLeft: `4px solid ${
                                            esPasoConv ? '#8b5cf6' : '#22c55e'
                                          }`,
                                          padding: '10px 12px',
                                          background: esPasoConv ? '#faf5ff' : '#f0fdf4',
                                          borderRadius: 8,
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: 8,
                                            alignItems: 'center',
                                            marginBottom: 6,
                                          }}
                                        >
                                          <span
                                            style={esPasoConv ? badgeConv : badgeCampo}
                                          >
                                            {esPasoConv ? 'Paso conversión' : 'Paso campo'}
                                          </span>
                                          <strong style={{ fontSize: 13 }}>
                                            {p.titulo || `Empaque #${p.empaque_id}`}
                                          </strong>
                                          <span style={{ fontSize: 12, color: '#64748b' }}>
                                            {p.fecha}
                                          </span>
                                        </div>
                                        {p.notas && (
                                          <p
                                            style={{
                                              margin: '0 0 8px',
                                              fontSize: 13,
                                              color: '#475569',
                                            }}
                                          >
                                            {p.notas}
                                          </p>
                                        )}
                                        <div
                                          style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: 16,
                                            fontSize: 12,
                                            color: '#334155',
                                          }}
                                        >
                                          {esPasoConv ? (
                                            <>
                                              <span>
                                                Granel usado:{' '}
                                                <strong>
                                                  {p.rpc_granel_usado} RPC (
                                                  {fmtKg(p.kg_granel || 0)} kg)
                                                </strong>
                                              </span>
                                              <span>
                                                → Final:{' '}
                                                <strong>
                                                  {fmtKg(p.kg_primera_final || 0)} kg
                                                </strong>
                                              </span>
                                              <span>
                                                RPC {fmtKg(p.kg_rpc || 0)} · cartón{' '}
                                                {fmtKg(p.kg_carton || 0)}
                                              </span>
                                            </>
                                          ) : (
                                            <>
                                              <span>
                                                Bins: <strong>{p.bins_campo}</strong> (
                                                {fmtKg(p.kg_entrada || 0)} kg)
                                              </span>
                                              <span>
                                                Final directo:{' '}
                                                <strong>
                                                  {fmtKg(p.kg_primera_final || 0)} kg
                                                </strong>{' '}
                                                (RPC {fmtKg(p.kg_rpc || 0)} · cartón{' '}
                                                {fmtKg(p.kg_carton || 0)})
                                              </span>
                                              {(p.rpc_granel_producido || 0) > 0 && (
                                                <span style={{ color: '#6d28d9' }}>
                                                  Granel sobrante:{' '}
                                                  <strong>
                                                    {p.rpc_granel_producido} RPC (
                                                    {fmtKg(p.kg_granel || 0)} kg)
                                                  </strong>
                                                </span>
                                              )}
                                              {(p.kg_segunda || 0) > 0 && (
                                                <span>
                                                  2da/jugo: {fmtKg(p.kg_segunda || 0)} kg
                                                </span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div
                                  style={{
                                    marginTop: 12,
                                    paddingTop: 10,
                                    borderTop: '1px dashed #cbd5e1',
                                    fontSize: 13,
                                    color: '#0f172a',
                                  }}
                                >
                                  <strong>Total proceso (solo final):</strong>{' '}
                                  {fmtKg(c.kg_primera)} kg 1ra = RPC {fmtKg(c.kg_rpc || 0)} +
                                  cartón {fmtKg(c.kg_carton || 0)}
                                  {c.kg_segunda > 0
                                    ? ` · ${fmtKg(c.kg_segunda)} kg 2da`
                                    : ''}{' '}
                                  · entrada {c.bins_campo} bins ({fmtKg(c.kg_entrada)} kg) ·{' '}
                                  <strong>{c.pct_primera}% 1ra</strong>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
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

const badgeBase: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 999,
};

const badgeCampo: CSSProperties = {
  ...badgeBase,
  background: '#dcfce7',
  color: '#166534',
};

const badgeConv: CSSProperties = {
  ...badgeBase,
  background: '#ede9fe',
  color: '#5b21b6',
};

const badgeProc: CSSProperties = {
  ...badgeBase,
  background: '#e0e7ff',
  color: '#3730a3',
};
