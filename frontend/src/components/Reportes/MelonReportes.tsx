import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { EmpaqueRecord } from '../../types';
import {
  HECTAREAS_MELON,
  HECTAREAS_MELON_POR_LOTE,
  HECTAREAS_MELON_TOTAL,
  HECTAREAS_POR_LOTE_MELON,
  cajasPorParrillaMelon,
  hectareasDesdeLoteMelon,
  labelCalidadMelon,
  labelPresentacionMelon,
  labelTallaCajaMelon,
  variedadDesdeLoteMelon,
} from '../../lib/constants';
import { formatFechaCorta } from '../../lib/dates';
import { getMelonHectareas } from '../../lib/api';
import {
  agregarDistribucionTallas,
  esProcesoCampoMelon,
  filtrarProcesosAcumulado,
  lotesDeEmpaqueMelon,
  sumaKgTallas,
} from '../../lib/melonDistribucionTallas';
import {
  pesoCajaDesdeConfig,
  useMelonPesos,
  type MelonPesosConfig,
} from '../../lib/melonPesos';

type Props = {
  empaques: EmpaqueRecord[];
  token?: string;
};

type Consumo = { lote?: string; bins?: number; fecha_recepcion?: string | null };
type LineaProd = {
  presentacion?: string;
  talla?: string | null;
  cantidad?: number;
  calidad?: string;
  cantidad_parrillas?: number;
  cajas_por_parrilla?: number;
  lote?: string | null;
  fecha_empaque?: string | null;
};

type ProcesoMelon = {
  id: number;
  fecha: string;
  lote: string;
  bins: number;
  cajasLlano: number;
  cajasWallys: number;
  kgLlano: number;
  kgWallys: number;
  parrillas: number;
  lineas: LineaProd[];
};

const cardPrimary: CSSProperties = {
  width: 180,
  minWidth: 160,
  maxWidth: 200,
  padding: '14px 14px 12px',
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxSizing: 'border-box',
  flex: '0 0 auto',
};

const cardLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.2,
  marginBottom: 4,
};

const cardValue: CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  lineHeight: 1.1,
};

const chip: CSSProperties = {
  flex: 1,
  background: 'rgba(255,255,255,0.55)',
  borderRadius: 8,
  padding: '6px 8px',
  minWidth: 0,
};

const chipLabel: CSSProperties = { fontSize: 10, color: '#64748b', fontWeight: 600 };
const chipValue: CSSProperties = { fontSize: 13, fontWeight: 800 };

const th: CSSProperties = { padding: '8px 10px', fontWeight: 700, fontSize: 12 };
const td: CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtKg(n: number): string {
  return `${fmtNum(n, 0)} kg`;
}

function parseDetalle(raw: unknown): {
  consumos?: Consumo[];
  produccion?: LineaProd[];
  tipo?: string | null;
  anulado?: boolean;
} {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as any;
  return {};
}

type MelonKpiData = {
  pctLlano: number;
  pctWallys: number;
  cajasLlano: number;
  cajasWallys: number;
  kgLlano: number;
  kgWallys: number;
  tonHa: number;
  kgLlanoHa: number;
  kgWallysHa: number;
  cajasHa: number;
  cajasLlanoHa: number;
  cajasWallysHa: number;
  binsPorParr: number | null;
  bins: number;
  parrillas: number;
};

/** Tarjetas KPI: LLANO · Wallys · ton/ha · cajas/ha · bins/parrilla */
function MelonKpiCards({ data }: { data: MelonKpiData }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'stretch',
        gap: 14,
        marginBottom: 16,
        width: '100%',
      }}
    >
      <div style={{ ...cardPrimary, background: '#e0f2fe' }}>
        <div style={{ ...cardLabel, color: '#075985' }}>1ra LLANO</div>
        <div style={{ ...cardValue, color: '#0c4a6e' }}>
          {data.pctLlano}
          <span style={{ fontSize: 15, fontWeight: 700 }}>%</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={chip}>
            <div style={chipLabel}>Cajas</div>
            <div style={{ ...chipValue, color: '#0c4a6e' }}>{fmtNum(data.cajasLlano, 0)}</div>
          </div>
          <div style={chip}>
            <div style={chipLabel}>Kg</div>
            <div style={{ ...chipValue, color: '#0c4a6e' }}>{fmtNum(data.kgLlano, 0)}</div>
          </div>
        </div>
      </div>

      <div style={{ ...cardPrimary, background: '#fef3c7' }}>
        <div style={{ ...cardLabel, color: '#92400e' }}>2da Wallys</div>
        <div style={{ ...cardValue, color: '#78350f' }}>
          {data.pctWallys}
          <span style={{ fontSize: 15, fontWeight: 700 }}>%</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={chip}>
            <div style={chipLabel}>Cajas</div>
            <div style={{ ...chipValue, color: '#78350f' }}>{fmtNum(data.cajasWallys, 0)}</div>
          </div>
          <div style={chip}>
            <div style={chipLabel}>Kg</div>
            <div style={{ ...chipValue, color: '#78350f' }}>{fmtNum(data.kgWallys, 0)}</div>
          </div>
        </div>
      </div>

      <div style={{ ...cardPrimary, background: '#f0fdf4' }}>
        <div style={{ ...cardLabel, color: '#166534' }}>Ton / ha</div>
        <div style={{ ...cardValue, color: '#14532d' }}>
          {Number.isFinite(data.tonHa) ? data.tonHa.toFixed(2) : '—'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={chip}>
            <div style={chipLabel}>LLANO</div>
            <div style={{ ...chipValue, color: '#14532d' }}>
              {fmtNum(data.kgLlanoHa / 1000, 2)} t
            </div>
          </div>
          <div style={chip}>
            <div style={chipLabel}>Wallys</div>
            <div style={{ ...chipValue, color: '#854d0e' }}>
              {fmtNum(data.kgWallysHa / 1000, 2)} t
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...cardPrimary, background: '#fdf4ff' }}>
        <div style={{ ...cardLabel, color: '#86198f' }}>Cajas / ha</div>
        <div style={{ ...cardValue, color: '#701a75' }}>
          {Number.isFinite(data.cajasHa) ? fmtNum(data.cajasHa, 0) : '—'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={chip}>
            <div style={chipLabel}>LLANO</div>
            <div style={{ ...chipValue, color: '#0c4a6e' }}>
              {fmtNum(data.cajasLlanoHa, 0)}
            </div>
          </div>
          <div style={chip}>
            <div style={chipLabel}>Wallys</div>
            <div style={{ ...chipValue, color: '#92400e' }}>
              {fmtNum(data.cajasWallysHa, 0)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...cardPrimary, background: '#ecfeff' }}>
        <div style={{ ...cardLabel, color: '#0e7490' }}>Bins / parrilla</div>
        <div style={{ ...cardValue, color: '#155e75' }}>
          {data.binsPorParr != null ? data.binsPorParr : '—'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={chip}>
            <div style={chipLabel}>Bins</div>
            <div style={{ ...chipValue, color: '#155e75' }}>{fmtNum(data.bins, 0)}</div>
          </div>
          <div style={chip}>
            <div style={chipLabel}>Parrillas</div>
            <div style={{ ...chipValue, color: '#155e75' }}>{fmtNum(data.parrillas, 1)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildProcesos(
  empaques: EmpaqueRecord[],
  pesos: MelonPesosConfig
): ProcesoMelon[] {
  const out: ProcesoMelon[] = [];
  for (const e of empaques.filter(esProcesoCampoMelon)) {
    const det = parseDetalle(e.detalle_corrida);
    const consumos = Array.isArray(det.consumos) ? det.consumos : [];
    const produccion = Array.isArray(det.produccion) ? det.produccion : [];
    const bins =
      consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0) ||
      Number(e.bins_desverdizado_usados) ||
      0;
    const lote =
      (det as any).lotes_resumen ||
      consumos.map((c) => c.lote).filter(Boolean).join(', ') ||
      e.lote_desverdizado ||
      '—';

    let cajasLlano = 0;
    let cajasWallys = 0;
    let kgLlano = 0;
    let kgWallys = 0;
    let parrillas = 0;

    for (const p of produccion) {
      const pres = String(p.presentacion || '');
      const cajas = Number(p.cantidad) || 0;
      if (cajas <= 0) continue;
      const kg = cajas * pesoCajaDesdeConfig(pesos, pres, p.talla);
      const cal = String(p.calidad || '').toLowerCase();
      const cpp = Number(p.cajas_por_parrilla) || cajasPorParrillaMelon(pres);
      const parr =
        Number(p.cantidad_parrillas) || (cpp > 0 ? cajas / cpp : 0);
      parrillas += parr;
      if (cal === 'wallys') {
        cajasWallys += cajas;
        kgWallys += kg;
      } else {
        cajasLlano += cajas;
        kgLlano += kg;
      }
    }

    if (bins <= 0 && cajasLlano + cajasWallys <= 0) continue;

    out.push({
      id: e.id,
      fecha: String(e.fecha || ''),
      lote: String(lote),
      bins,
      cajasLlano,
      cajasWallys,
      kgLlano,
      kgWallys,
      parrillas: Math.round(parrillas * 100) / 100,
      lineas: produccion,
    });
  }
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

type FiltroAcumuladoTipo = 'todos' | 'variedad' | 'corrida';

function lotesDeProceso(p: ProcesoMelon, empaques: EmpaqueRecord[]): string[] {
  const e = empaques.find((x) => x.id === p.id);
  if (e) {
    const lots = lotesDeEmpaqueMelon(e);
    if (lots.length > 0) return lots;
  }
  return String(p.lote || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildKpiFromProcesos(
  procs: ProcesoMelon[],
  ha: number,
  binCampoKg: number
): MelonKpiData & { hectareas: number; kgTotal: number; cajasTotal: number } {
  const bins = procs.reduce((s, p) => s + p.bins, 0);
  const cajasLlano = procs.reduce((s, p) => s + p.cajasLlano, 0);
  const cajasWallys = procs.reduce((s, p) => s + p.cajasWallys, 0);
  const kgLlano = procs.reduce((s, p) => s + p.kgLlano, 0);
  const kgWallys = procs.reduce((s, p) => s + p.kgWallys, 0);
  const kgTotal = kgLlano + kgWallys;
  const cajasTotal = cajasLlano + cajasWallys;
  const kgEntrada = bins * binCampoKg;
  const parrillas = procs.reduce((s, p) => s + p.parrillas, 0);
  const pctLlano =
    kgEntrada > 0 ? (kgLlano / kgEntrada) * 100 : kgTotal > 0 ? (kgLlano / kgTotal) * 100 : 0;
  const pctWallys =
    kgEntrada > 0 ? (kgWallys / kgEntrada) * 100 : kgTotal > 0 ? (kgWallys / kgTotal) * 100 : 0;
  const haSafe = ha > 0 ? ha : 0;
  const binsPorParr =
    parrillas > 0 && bins > 0 ? Math.round((bins / parrillas) * 100) / 100 : null;
  return {
    bins,
    cajasLlano,
    cajasWallys,
    cajasTotal,
    kgLlano,
    kgWallys,
    kgTotal,
    parrillas: Math.round(parrillas * 100) / 100,
    pctLlano: Math.round(pctLlano * 10) / 10,
    pctWallys: Math.round(pctWallys * 10) / 10,
    tonHa: haSafe > 0 ? kgTotal / 1000 / haSafe : 0,
    cajasHa: haSafe > 0 ? cajasTotal / haSafe : 0,
    cajasLlanoHa: haSafe > 0 ? cajasLlano / haSafe : 0,
    cajasWallysHa: haSafe > 0 ? cajasWallys / haSafe : 0,
    kgLlanoHa: haSafe > 0 ? kgLlano / haSafe : 0,
    kgWallysHa: haSafe > 0 ? kgWallys / haSafe : 0,
    binsPorParr,
    hectareas: haSafe,
  };
}

export default function MelonReportes({ empaques, token }: Props) {
  const { pesos } = useMelonPesos();
  const procesos = useMemo(() => buildProcesos(empaques, pesos), [empaques, pesos]);

  /** lote → hectáreas (API o fallback local) */
  const [haPorLote, setHaPorLote] = useState<Record<string, number>>(HECTAREAS_MELON_POR_LOTE);
  const [haTotalCatalogo, setHaTotalCatalogo] = useState(HECTAREAS_MELON_TOTAL || HECTAREAS_MELON);

  /** Filtro opcional del acumulado KPI */
  const [filtroTipo, setFiltroTipo] = useState<FiltroAcumuladoTipo>('todos');
  /** Valor único para variedad; corridas usan filtroCorridas (multi). */
  const [filtroValor, setFiltroValor] = useState('');
  const [filtroCorridas, setFiltroCorridas] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getMelonHectareas(token)
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const l of data.lotes || []) {
          if (l.lote) map[l.lote] = Number(l.hectareas) || 0;
        }
        if (Object.keys(map).length > 0) {
          setHaPorLote(map);
          setHaTotalCatalogo(
            Number(data.total_hectareas) ||
              Object.values(map).reduce((s, n) => s + n, 0)
          );
        }
      })
      .catch(() => {
        /* fallback local ya cargado */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const haDeLote = (lote: string): number => {
    const h = hectareasDesdeLoteMelon(lote, haPorLote);
    return h != null && h > 0 ? h : HECTAREAS_POR_LOTE_MELON;
  };

  const variedadesDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const p of procesos) {
      for (const lote of lotesDeProceso(p, empaques)) {
        set.add(variedadDesdeLoteMelon(lote));
      }
    }
    return [...set].filter((v) => v && v !== 'Sin variedad').sort((a, b) => a.localeCompare(b));
  }, [procesos, empaques]);

  const corridasDisponibles = useMemo(
    () =>
      [...procesos]
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id)
        .map((p) => ({
          id: String(p.id),
          label: `#${p.id} · ${formatFechaCorta(p.fecha)} · ${p.lote}`,
        })),
    [procesos]
  );

  // Si cambia el tipo de filtro, limpiar valor; si el valor ya no existe, resetear
  useEffect(() => {
    if (filtroTipo === 'todos') {
      setFiltroValor('');
      setFiltroCorridas([]);
      return;
    }
    if (filtroTipo === 'variedad') {
      setFiltroCorridas([]);
      if (filtroValor && !variedadesDisponibles.includes(filtroValor)) {
        setFiltroValor(variedadesDisponibles[0] || '');
      }
    } else if (filtroTipo === 'corrida') {
      setFiltroValor('');
      const ids = new Set(corridasDisponibles.map((c) => c.id));
      setFiltroCorridas((prev) => {
        const kept = prev.filter((id) => ids.has(id));
        if (kept.length > 0) return kept;
        return corridasDisponibles[0] ? [corridasDisponibles[0].id] : [];
      });
    }
  }, [filtroTipo, variedadesDisponibles, corridasDisponibles, filtroValor]);

  const procesosKpi = useMemo(
    () =>
      filtrarProcesosAcumulado(
        procesos,
        (p) => lotesDeProceso(p, empaques),
        { tipo: filtroTipo, variedad: filtroValor, corridaIds: filtroCorridas },
        variedadDesdeLoteMelon
      ),
    [procesos, empaques, filtroTipo, filtroValor, filtroCorridas]
  );

  const haParaKpi = useMemo(() => {
    if (filtroTipo === 'todos') {
      return haTotalCatalogo > 0 ? haTotalCatalogo : HECTAREAS_MELON;
    }
    if (filtroTipo === 'variedad') {
      if (!filtroValor) return haTotalCatalogo > 0 ? haTotalCatalogo : HECTAREAS_MELON;
      // Ha plantadas de esa variedad en catálogo
      let sum = 0;
      for (const [lote, ha] of Object.entries(haPorLote)) {
        if (variedadDesdeLoteMelon(lote) === filtroValor) sum += ha;
      }
      return sum > 0 ? sum : HECTAREAS_POR_LOTE_MELON;
    }
    // corrida(s): suma ha de lotes de las corridas seleccionadas
    if (filtroCorridas.length === 0) return 0;
    const procs = procesosKpi;
    const lotes = new Set<string>();
    for (const p of procs) {
      for (const l of lotesDeProceso(p, empaques)) lotes.add(l);
    }
    let sum = 0;
    for (const l of lotes) sum += haDeLote(l);
    return sum > 0 ? sum : HECTAREAS_POR_LOTE_MELON;
  }, [filtroTipo, filtroValor, filtroCorridas, haTotalCatalogo, haPorLote, procesosKpi, empaques]);

  const acumulado = useMemo(
    () => buildKpiFromProcesos(procesosKpi, haParaKpi, pesos.bin_campo_kg),
    [procesosKpi, haParaKpi, pesos.bin_campo_kg]
  );

  /** Vista del pastel/tabla de tallas: simple (#6s…) o tipos de caja (#6s Jumbo…). */
  const [vistaTallas, setVistaTallas] = useState<'simple' | 'tipos_caja'>('simple');

  /** Mismos empaques que las tarjetas del filtro activo. */
  const empaquesDistribucion = useMemo(() => {
    const ids = new Set(procesosKpi.map((p) => p.id));
    return empaques.filter((e) => ids.has(e.id));
  }, [empaques, procesosKpi]);

  /** Distribución por talla + tipo de caja (todas las calidades, kg). */
  const porTallaCaja = useMemo(
    () =>
      agregarDistribucionTallas(
        empaquesDistribucion,
        (pres, talla) => pesoCajaDesdeConfig(pesos, pres, talla),
        'tipos_caja'
      ),
    [empaquesDistribucion, pesos]
  );

  /** Distribución solo por talla (#6s, #9s…), sumando todos los tipos de caja. */
  const porTallaSimple = useMemo(
    () =>
      agregarDistribucionTallas(
        empaquesDistribucion,
        (pres, talla) => pesoCajaDesdeConfig(pesos, pres, talla),
        'simple'
      ),
    [empaquesDistribucion, pesos]
  );

  const distribucionTallas = vistaTallas === 'simple' ? porTallaSimple : porTallaCaja;
  const totalesTallas = sumaKgTallas(distribucionTallas);

  const porLote = useMemo(() => {
    type LoteAgg = {
      lote: string;
      bins: number;
      kg: number;
      kgLlano: number;
      kgWallys: number;
      cajasLlano: number;
      cajasWallys: number;
      parrillas: number;
    };
    const map = new Map<string, LoteAgg>();
    const empty = (lote: string): LoteAgg => ({
      lote,
      bins: 0,
      kg: 0,
      kgLlano: 0,
      kgWallys: 0,
      cajasLlano: 0,
      cajasWallys: 0,
      parrillas: 0,
    });
    for (const p of procesos) {
      // Un proceso puede listar varios lotes en el resumen; usar consumos reales
      const e = empaques.find((x) => x.id === p.id);
      const det = parseDetalle(e?.detalle_corrida);
      const consumos = det.consumos || [];
      const prod = det.produccion || [];
      const kgProd = prod.reduce(
        (s, ln) =>
          s +
          (Number(ln.cantidad) || 0) *
            pesoCajaDesdeConfig(pesos, String(ln.presentacion || ''), ln.talla),
        0
      );
      const kgLlano = prod
        .filter((ln) => String(ln.calidad || '').toLowerCase() !== 'wallys')
        .reduce(
          (s, ln) =>
            s +
            (Number(ln.cantidad) || 0) *
              pesoCajaDesdeConfig(pesos, String(ln.presentacion || ''), ln.talla),
          0
        );
      const kgWallys = kgProd - kgLlano;
      const cajasLlano = prod
        .filter((ln) => String(ln.calidad || '').toLowerCase() !== 'wallys')
        .reduce((s, ln) => s + (Number(ln.cantidad) || 0), 0);
      const cajasWallys = prod
        .filter((ln) => String(ln.calidad || '').toLowerCase() === 'wallys')
        .reduce((s, ln) => s + (Number(ln.cantidad) || 0), 0);
      const parr = prod.reduce((s, ln) => {
        const cajas = Number(ln.cantidad) || 0;
        const cpp =
          Number(ln.cajas_por_parrilla) ||
          cajasPorParrillaMelon(String(ln.presentacion || ''));
        return s + (Number(ln.cantidad_parrillas) || (cpp > 0 ? cajas / cpp : 0));
      }, 0);

      const totalBins = consumos.reduce((s, c) => s + (Number(c.bins) || 0), 0) || 1;
      if (consumos.length === 0) {
        const lote = p.lote || '—';
        const row = map.get(lote) || empty(lote);
        row.bins += p.bins;
        row.kg += kgProd;
        row.kgLlano += kgLlano;
        row.kgWallys += kgWallys;
        row.cajasLlano += cajasLlano;
        row.cajasWallys += cajasWallys;
        row.parrillas += parr;
        map.set(lote, row);
        continue;
      }
      for (const c of consumos) {
        const lote = String(c.lote || '—').trim() || '—';
        const share = (Number(c.bins) || 0) / totalBins;
        const row = map.get(lote) || empty(lote);
        row.bins += Number(c.bins) || 0;
        row.kg += kgProd * share;
        row.kgLlano += kgLlano * share;
        row.kgWallys += kgWallys * share;
        row.cajasLlano += cajasLlano * share;
        row.cajasWallys += cajasWallys * share;
        row.parrillas += parr * share;
        map.set(lote, row);
      }
    }
    return [...map.values()]
      .map((r) => {
        const ha = haDeLote(r.lote);
        return {
          ...r,
          kg: Math.round(r.kg * 10) / 10,
          kgLlano: Math.round(r.kgLlano * 10) / 10,
          kgWallys: Math.round(r.kgWallys * 10) / 10,
          cajasLlano: Math.round(r.cajasLlano),
          cajasWallys: Math.round(r.cajasWallys),
          parrillas: Math.round(r.parrillas * 100) / 100,
          hectareas: ha,
          tonHa: ha > 0 ? r.kg / 1000 / ha : 0,
        };
      })
      .sort((a, b) => b.kg - a.kg);
  }, [procesos, empaques, pesos, haPorLote]);

  /** Calidades por variedad: ton/ha y cajas/ha (LLANO + Wallys) por variedad. */
  const porVariedad = useMemo(() => {
    const map = new Map<
      string,
      {
        variedad: string;
        kgLlano: number;
        kgWallys: number;
        cajasLlano: number;
        cajasWallys: number;
        lotes: number;
        hectareas: number;
      }
    >();
    for (const l of porLote) {
      const variedad = variedadDesdeLoteMelon(l.lote);
      const row = map.get(variedad) || {
        variedad,
        kgLlano: 0,
        kgWallys: 0,
        cajasLlano: 0,
        cajasWallys: 0,
        lotes: 0,
        hectareas: 0,
      };
      row.kgLlano += l.kgLlano || 0;
      row.kgWallys += l.kgWallys || 0;
      row.cajasLlano += l.cajasLlano || 0;
      row.cajasWallys += l.cajasWallys || 0;
      row.lotes += 1;
      row.hectareas += l.hectareas || haDeLote(l.lote);
      map.set(variedad, row);
    }
    return [...map.values()]
      .map((r) => {
        const ha = r.hectareas;
        const tonLlano = r.kgLlano / 1000;
        const tonWallys = r.kgWallys / 1000;
        const tonTotal = tonLlano + tonWallys;
        return {
          variedad: r.variedad,
          tonLlano,
          tonWallys,
          tonTotal,
          tonLlanoHa: ha > 0 ? tonLlano / ha : 0,
          tonWallysHa: ha > 0 ? tonWallys / ha : 0,
          tonHaTotal: ha > 0 ? tonTotal / ha : 0,
          cajasLlanoHa: ha > 0 ? r.cajasLlano / ha : 0,
          cajasWallysHa: ha > 0 ? r.cajasWallys / ha : 0,
          cajasHaTotal: ha > 0 ? (r.cajasLlano + r.cajasWallys) / ha : 0,
          hectareas: Math.round(ha * 10) / 10,
          lotes: r.lotes,
        };
      })
      .sort((a, b) => b.tonHaTotal - a.tonHaTotal);
  }, [porLote, haPorLote]);

  const tallaColors = [
    '#0284c7',
    '#16a34a',
    '#7c3aed',
    '#ca8a04',
    '#db2777',
    '#ea580c',
    '#0f766e',
    '#4f46e5',
  ];

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
        Melón · Bin campo = <strong>{pesos.bin_campo_kg} kg</strong> · Caja chica ={' '}
        {pesos.caja_chica_a} kg · Normal = {pesos.caja_normal_b} kg · Jumbo = {pesos.caja_jumbo_c}{' '}
        kg · Ha totales = <strong>{fmtNum(haTotalCatalogo || HECTAREAS_MELON, 1)}</strong> · Ha por
        lote desde catálogo BD · Parrilla A/B = 56 cajas · Jumbo = 49 ·{' '}
        <strong>Bins/parrilla = bins ÷ parrillas empacadas</strong>
      </p>

      {procesos.length === 0 ? (
        <p style={{ color: '#64748b' }}>
          No hay empaques de melón registrados todavía. Captura recepción + empaque para ver
          indicadores.
        </p>
      ) : (
        <>
          <h3 style={{ margin: '12px 0 8px', textAlign: 'center' }}>
            Acumulado — indicadores principales
          </h3>

          {/* Filtro opcional: todos | variedad | corrida */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}
            >
              Filtrar
            </span>
            {(
              [
                ['todos', 'Todo'],
                ['variedad', 'Por variedad'],
                ['corrida', 'Por corrida'],
              ] as const
            ).map(([id, lab]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setFiltroTipo(id);
                  if (id === 'todos') {
                    setFiltroValor('');
                    setFiltroCorridas([]);
                  } else if (id === 'variedad') {
                    setFiltroCorridas([]);
                    setFiltroValor(variedadesDisponibles[0] || '');
                  } else {
                    setFiltroValor('');
                    setFiltroCorridas(
                      corridasDisponibles[0] ? [corridasDisponibles[0].id] : []
                    );
                  }
                }}
                style={{
                  padding: '7px 14px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: filtroTipo === id ? 700 : 500,
                  fontSize: 13,
                  background: filtroTipo === id ? '#0f172a' : '#fff',
                  color: filtroTipo === id ? '#fff' : '#334155',
                }}
              >
                {lab}
              </button>
            ))}
            {filtroTipo === 'variedad' && (
              <select
                value={filtroValor}
                onChange={(e) => setFiltroValor(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                  minWidth: 160,
                }}
              >
                {variedadesDisponibles.length === 0 && (
                  <option value="">Sin variedades</option>
                )}
                {variedadesDisponibles.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {filtroTipo === 'corrida' && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  justifyContent: 'center',
                  maxWidth: 640,
                  padding: '8px 10px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  background: '#f8fafc',
                }}
              >
                {corridasDisponibles.length === 0 && (
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>Sin corridas</span>
                )}
                {corridasDisponibles.map((c) => {
                  const on = filtroCorridas.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setFiltroCorridas((prev) =>
                          on ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                        );
                      }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: on ? '1px solid #0f172a' : '1px solid #cbd5e1',
                        background: on ? '#0f172a' : '#fff',
                        color: on ? '#fff' : '#334155',
                        fontSize: 12,
                        fontWeight: on ? 700 : 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      title={on ? 'Quitar de la selección' : 'Agregar a la selección'}
                    >
                      {c.label}
                    </button>
                  );
                })}
                {corridasDisponibles.length > 0 && (
                  <div style={{ width: '100%', display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setFiltroCorridas(corridasDisponibles.map((c) => c.id))
                      }
                      style={{
                        padding: '4px 8px',
                        fontSize: 11,
                        border: 'none',
                        background: 'transparent',
                        color: '#2563eb',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltroCorridas([])}
                      style={{
                        padding: '4px 8px',
                        fontSize: 11,
                        border: 'none',
                        background: 'transparent',
                        color: '#64748b',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Ninguna
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, textAlign: 'center' }}>
            {filtroTipo === 'todos' && (
              <>Total plantado · {fmtNum(acumulado.hectareas, 1)} ha</>
            )}
            {filtroTipo === 'variedad' && filtroValor && (
              <>
                Variedad <strong>{filtroValor}</strong> · {fmtNum(acumulado.hectareas, 1)} ha ·{' '}
                {procesosKpi.length} corrida{procesosKpi.length !== 1 ? 's' : ''}
              </>
            )}
            {filtroTipo === 'corrida' && (
              <>
                {filtroCorridas.length} corrida
                {filtroCorridas.length !== 1 ? 's' : ''} · {fmtNum(acumulado.hectareas, 1)} ha
                de lote(s)
              </>
            )}
          </p>
          {procesosKpi.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
              No hay datos para este filtro.
            </p>
          ) : (
            <MelonKpiCards data={acumulado} />
          )}

          {/* Distribución por tallas melón */}
          <h3 style={{ margin: '20px 0 6px', textAlign: 'center' }}>
            Distribución por tallas
          </h3>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}
            >
              Vista
            </span>
            {(
              [
                ['simple', 'Simple'],
                ['tipos_caja', 'Tipos de cajas'],
              ] as const
            ).map(([id, lab]) => (
              <button
                key={id}
                type="button"
                onClick={() => setVistaTallas(id)}
                style={{
                  padding: '7px 14px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: vistaTallas === id ? 700 : 500,
                  fontSize: 13,
                  background: vistaTallas === id ? '#0f172a' : '#fff',
                  color: vistaTallas === id ? '#fff' : '#334155',
                }}
              >
                {lab}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, textAlign: 'center' }}>
            {vistaTallas === 'simple'
              ? 'Solo tallas (#6s, #9s, #12s…). Suma todos los tipos de caja. Kg = LLANO + Wallys.'
              : 'Talla × tipo de caja (ej. #6s Jumbo, #9s Chica, #12s Normal). Kg = LLANO + Wallys.'}
            {' '}
            {filtroTipo === 'todos'
              ? 'Todo el acumulado.'
              : filtroTipo === 'variedad'
                ? `Solo la variedad ${filtroValor || '—'}.`
                : `Solo ${filtroCorridas.length} corrida${filtroCorridas.length === 1 ? '' : 's'}.`}
            {' '}
            El total es el mismo que 1ra LLANO + 2da Wallys de las tarjetas.
          </p>
          {distribucionTallas.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
              Sin desglose de tallas aún.
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                width: '100%',
                marginBottom: 8,
              }}
            >
              <MelonTallaPie
                items={distribucionTallas.map((t) => ({
                  talla: t.label,
                  kg: t.kg,
                  cajas: t.cajas,
                }))}
                kgWallys={0}
                colors={tallaColors}
                fmtKg={fmtKg}
              />
            </div>
          )}

          <div
            style={{
              overflowX: 'auto',
              marginTop: 8,
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <table
              style={{
                width: '100%',
                maxWidth: 720,
                borderCollapse: 'collapse',
                fontSize: 13,
                minWidth: 520,
              }}
            >
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <th style={th}>{vistaTallas === 'simple' ? 'Talla' : 'Talla / caja'}</th>
                  <th style={th}>Cajas</th>
                  <th style={th}>Kg LLANO</th>
                  <th style={th}>Kg Wallys</th>
                  <th style={th}>Kg total</th>
                </tr>
              </thead>
              <tbody>
                {distribucionTallas.map((t) => (
                  <tr
                    key={
                      vistaTallas === 'simple'
                        ? t.talla
                        : `${t.presentacion}|${t.talla}`
                    }
                    style={{ borderBottom: '1px solid #e2e8f0' }}
                  >
                    <td style={td}>
                      <strong>{t.label}</strong>
                      {vistaTallas === 'tipos_caja' && t.presentacion ? (
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          {labelPresentacionMelon(t.presentacion)}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>{fmtNum(t.cajas, 0)}</td>
                    <td style={td}>{fmtNum(t.llano, 0)}</td>
                    <td style={td}>{fmtNum(t.wallys, 0)}</td>
                    <td style={td}>
                      <strong>{fmtNum(t.kg, 0)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              {distribucionTallas.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td style={td}>Total</td>
                    <td style={td}>{fmtNum(totalesTallas.cajas, 0)}</td>
                    <td style={td}>{fmtNum(totalesTallas.llano, 0)}</td>
                    <td style={td}>{fmtNum(totalesTallas.wallys, 0)}</td>
                    <td style={td}>{fmtNum(totalesTallas.kg, 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Barras por lote */}
          <h3 style={{ margin: '8px 0 6px' }}>Toneladas / producción por lote</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            Barras = <strong>ton/ha</strong> por lote (kg empacados ÷ hectáreas del catálogo).
          </p>
          <MelonLoteBarras lotes={porLote} />

          <h3 style={{ margin: '20px 0 6px', textAlign: 'center' }}>Calidades por variedad</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, textAlign: 'center' }}>
            Por cada variedad se muestran juntas 1ra LLANO (azul) y 2da Wallys (café). Alterna entre
            ton/ha y cajas/ha.
          </p>
          <MelonVariedadBarras variedades={porVariedad} />

          <div style={{ overflowX: 'auto', marginTop: 12, marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <th style={th}>Lote</th>
                  <th style={th}>Bins</th>
                  <th style={th}>Parrillas</th>
                  <th style={th}>Kg LLANO</th>
                  <th style={th}>Kg Wallys</th>
                  <th style={th}>Kg total</th>
                  <th style={th}>t/ha</th>
                </tr>
              </thead>
              <tbody>
                {porLote.map((l) => (
                  <tr key={l.lote} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={td}>
                      <strong>{l.lote}</strong>
                    </td>
                    <td style={td}>{l.bins}</td>
                    <td style={td}>{fmtNum(l.parrillas, 2)}</td>
                    <td style={td}>{fmtNum(l.kgLlano, 0)}</td>
                    <td style={td}>{fmtNum(l.kgWallys, 0)}</td>
                    <td style={td}>
                      <strong>{fmtNum(l.kg, 0)}</strong>
                    </td>
                    <td style={td}>{fmtNum(l.tonHa, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p
            style={{
              fontSize: 12,
              color: '#92400e',
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 8,
              padding: 10,
              marginBottom: 16,
            }}
          >
            Mapa de cuadros / secciones melón: en desarrollo — omitido por ahora.
          </p>

          {/* Acumulado de procesos */}
          <h3 style={{ margin: '8px 0 6px' }}>Acumulado de procesos de empacado</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            Cada registro de empaque (un lote por corrida). {procesos.length} proceso(s). Filas del
            mismo día comparten fondo; al cambiar de fecha alterna blanco / azul claro.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <th style={th}>Fecha</th>
                  <th style={th}>Lote</th>
                  <th style={th}>Bins</th>
                  <th style={th}>Parrillas</th>
                  <th style={th}>Cajas LLANO</th>
                  <th style={th}>Cajas Wallys</th>
                  <th style={th}>Kg total</th>
                  <th style={th}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let dayIdx = -1;
                  let prevDay = '';
                  return procesos.map((p) => {
                    const day = String(p.fecha || '').slice(0, 10);
                    if (day !== prevDay) {
                      dayIdx += 1;
                      prevDay = day;
                    }
                    const bg = dayIdx % 2 === 0 ? '#ffffff' : '#e0f2fe';
                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: bg,
                        }}
                      >
                        <td style={td}>{formatFechaCorta(p.fecha)}</td>
                        <td style={td}>
                          <strong>{p.lote}</strong>
                        </td>
                        <td style={td}>{p.bins}</td>
                        <td style={td}>{fmtNum(p.parrillas, 2)}</td>
                        <td style={td}>{fmtNum(p.cajasLlano, 0)}</td>
                        <td style={td}>{fmtNum(p.cajasWallys, 0)}</td>
                        <td style={td}>
                          <strong>{fmtNum(p.kgLlano + p.kgWallys, 0)}</strong>
                        </td>
                        <td style={td}>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {p.lineas
                              .filter((ln) => (Number(ln.cantidad) || 0) > 0)
                              .slice(0, 6)
                              .map((ln, i) => (
                                <div key={i}>
                                  {labelCalidadMelon(String(ln.calidad || 'llano'))} ·{' '}
                                  {labelTallaCajaMelon(
                                    String(ln.presentacion || ''),
                                    String(ln.talla || '')
                                  )}
                                  : {ln.cantidad} cajas
                                </div>
                              ))}
                            {p.lineas.filter((ln) => (Number(ln.cantidad) || 0) > 0).length >
                              6 && <div>…</div>}
                          </div>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MelonTallaPie({
  items,
  kgWallys,
  colors,
  fmtKg,
}: {
  items: Array<{ talla: string; kg: number; cajas: number }>;
  kgWallys: number;
  colors: string[];
  fmtKg: (n: number) => string;
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const r = 124;

  type Slice = { key: string; label: string; kg: number; color: string; calidad: '1ra' | '2da' };
  const raw: Slice[] = items
    .filter((t) => (Number(t.kg) || 0) > 0)
    .map((t, i) => ({
      key: `t-${t.talla}`,
      label: String(t.talla),
      kg: Number(t.kg) || 0,
      color: colors[i % colors.length],
      calidad: '1ra' as const,
    }));
  if (kgWallys > 0) {
    raw.push({
      key: 'wallys',
      label: 'Wallys',
      kg: kgWallys,
      color: '#f472b6',
      calidad: '2da',
    });
  }
  const totalKg = raw.reduce((s, x) => s + x.kg, 0) || 1;
  const slices = raw.map((s) => ({ ...s, pct: (s.kg / totalKg) * 100 }));

  const polar = (angleDeg: number, radius: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  let angle = 0;
  const paths = slices.map((s) => {
    const sweep = (s.pct / 100) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const mid = start + sweep / 2;
    const large = sweep > 180 ? 1 : 0;
    const p0 = polar(start, r);
    const p1 = polar(end, r);
    const d =
      sweep >= 359.99
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
        : `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
    return { ...s, d, mid, sweep };
  });

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 20,
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        width: '100%',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        {paths.map((p) => (
          <path key={p.key} d={p.d} fill={p.color} stroke="#fff" strokeWidth={1.5} />
        ))}
      </svg>
      <div style={{ fontSize: 13, minWidth: 180, textAlign: 'left' }}>
        {slices.map((s) => (
          <div key={s.key} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: s.color,
                display: 'inline-block',
              }}
            />
            <span style={{ fontWeight: 700 }}>{s.label}</span>
            <span style={{ color: '#64748b' }}>
              {fmtNum(s.pct, 1)}% · {fmtKg(s.kg)}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 8, color: '#475569', fontWeight: 600 }}>
          Total: {fmtKg(totalKg)}
        </div>
      </div>
    </div>
  );
}

function MelonLoteBarras({
  lotes,
}: {
  lotes: Array<{ lote: string; kg: number; bins: number; tonHa?: number; hectareas?: number }>;
}) {
  const bars = [...lotes]
    .map((l) => ({
      ...l,
      tonHa:
        l.tonHa != null && Number.isFinite(l.tonHa)
          ? l.tonHa
          : (l.hectareas || 0) > 0
            ? l.kg / 1000 / (l.hectareas as number)
            : 0,
    }))
    .filter((l) => l.tonHa > 0.0001)
    .sort((a, b) => b.tonHa - a.tonHa)
    .slice(0, 10);
  if (bars.length === 0) {
    return (
      <p style={{ color: '#64748b', fontSize: 13 }}>
        No hay producción por lote para graficar (ton/ha).
      </p>
    );
  }
  const maxTonHa = Math.max(...bars.map((b) => b.tonHa), 0.01);
  const padTop = 20;
  const padBottom = 90; // espacio para etiquetas inclinadas
  const padLeft = 44;
  const chartH = 160 + padTop + padBottom;
  const innerH = chartH - padTop - padBottom;
  const n = bars.length;
  const chartW = Math.max(520, n * 88);
  const gap = 16;
  const barW = Math.min(52, (chartW - gap * (n + 1) - padLeft) / n);
  const fmtTonHa = (n: number) =>
    n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3);

  return (
    <div style={{ overflowX: 'auto', marginBottom: 8 }}>
      <svg
        width={chartW}
        height={chartH}
        viewBox={`0 0 ${chartW} ${chartH}`}
        role="img"
        aria-label="Toneladas por hectárea por lote"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padLeft}
                y1={y}
                x2={chartW - 8}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text x={4} y={y + 4} fontSize={10} fill="#94a3b8" fontWeight={600}>
                {fmtTonHa(maxTonHa * t)}
              </text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const h = (b.tonHa / maxTonHa) * innerH;
          const x = gap + i * (barW + gap) + padLeft;
          const y = padTop + innerH - h;
          const labelX = x + barW / 2;
          const labelY = padTop + innerH + 10;
          return (
            <g key={b.lote}>
              <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={6} fill="#0284c7" />
              <text
                x={labelX}
                y={y - 4}
                textAnchor="middle"
                fontSize={10}
                fill="#0c4a6e"
                fontWeight={700}
              >
                {fmtTonHa(b.tonHa)}
              </text>
              <text
                x={labelX}
                y={labelY}
                textAnchor="end"
                fontSize={11}
                fill="#334155"
                fontWeight={700}
                transform={`rotate(-40 ${labelX} ${labelY})`}
              >
                {b.lote}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type VariedadMetric = 'ton_ha' | 'cajas_ha';

type VariedadBarRow = {
  variedad: string;
  tonLlano: number;
  tonWallys: number;
  tonTotal: number;
  tonLlanoHa: number;
  tonWallysHa: number;
  tonHaTotal: number;
  cajasLlanoHa: number;
  cajasWallysHa: number;
  cajasHaTotal: number;
  hectareas?: number;
  lotes?: number;
};

/**
 * Barras agrupadas por variedad: LLANO (azul claro) y Wallys (café claro) lado a lado.
 * Toggle Ton/Ha | Cajas/Ha. Hover muestra ambas calidades juntas.
 */
function MelonVariedadBarras({ variedades }: { variedades: VariedadBarRow[] }) {
  const [metric, setMetric] = useState<VariedadMetric>('ton_ha');
  const [hover, setHover] = useState<{
    variedad: string;
    x: number;
    y: number;
  } | null>(null);

  const bars = variedades
    .map((v) => {
      const a = metric === 'ton_ha' ? v.tonLlanoHa : v.cajasLlanoHa;
      const b = metric === 'ton_ha' ? v.tonWallysHa : v.cajasWallysHa;
      const total = metric === 'ton_ha' ? v.tonHaTotal : v.cajasHaTotal;
      return { ...v, a, b, total };
    })
    .filter((v) => v.total > 0.0001)
    .sort((x, y) => y.total - x.total);

  if (variedades.length === 0 || bars.length === 0) {
    return (
      <p style={{ color: '#64748b', fontSize: 13, textAlign: 'center' }}>
        No hay datos por variedad para graficar.
      </p>
    );
  }

  const COLOR_LLANO = '#93c5fd';
  const COLOR_LLANO_STROKE = '#60a5fa';
  const COLOR_WALLYS = '#d6b08a';
  const COLOR_WALLYS_STROKE = '#b8956c';
  const maxVal = Math.max(...bars.flatMap((b) => [b.a, b.b]), 0.01);
  const chartH = 250;
  const padTop = 28;
  const padBottom = 52;
  const padLeft = 52;
  const innerH = chartH - padTop - padBottom;
  const n = bars.length;
  const groupGap = 28;
  const pairGap = 4;
  const singleW = 28;
  const groupW = singleW * 2 + pairGap;
  const chartW = Math.max(520, padLeft + groupGap + n * (groupW + groupGap));

  const esTonHa = metric === 'ton_ha';
  const unidad = esTonHa ? 't/ha' : 'cj/ha';
  const fmtVal = (t: number) => {
    if (esTonHa) return t >= 10 ? t.toFixed(1) : t >= 1 ? t.toFixed(2) : t.toFixed(3);
    return Math.round(t).toLocaleString('en-US');
  };
  const fmtAxis = (t: number) => {
    if (esTonHa) return fmtVal(t);
    return Math.round(t).toLocaleString('en-US');
  };

  const metricBtn = (id: VariedadMetric): CSSProperties => ({
    padding: '7px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: metric === id ? 700 : 500,
    fontSize: 13,
    background: metric === id ? '#0f172a' : '#fff',
    color: metric === id ? '#fff' : '#334155',
  });

  const hoveredBar = hover ? bars.find((b) => b.variedad === hover.variedad) : null;
  const tip = hoveredBar
    ? (() => {
        const total = hoveredBar.total || 0.0001;
        const pct1 = (hoveredBar.a / total) * 100;
        const pct2 = (hoveredBar.b / total) * 100;
        const haLabel =
          hoveredBar.hectareas != null
            ? ` · ${hoveredBar.hectareas} ha`
            : '';
        return {
          title: `${hoveredBar.variedad}${haLabel}`,
          total: `Total: ${fmtVal(hoveredBar.total)} ${unidad}`,
          llano: `1ra LLANO: ${fmtVal(hoveredBar.a)} ${unidad} (${pct1.toFixed(1)}%)`,
          wallys: `2da Wallys: ${fmtVal(hoveredBar.b)} ${unidad} (${pct2.toFixed(1)}%)`,
        };
      })()
    : null;

  return (
    <div style={{ marginBottom: 12, position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: 0.3,
          }}
        >
          Comparar
        </span>
        <button type="button" style={metricBtn('ton_ha')} onClick={() => setMetric('ton_ha')}>
          Ton / Ha
        </button>
        <button type="button" style={metricBtn('cajas_ha')} onClick={() => setMetric('cajas_ha')}>
          Cajas / Ha
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          fontSize: 12,
          marginBottom: 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: COLOR_LLANO,
              border: `1px solid ${COLOR_LLANO_STROKE}`,
              display: 'inline-block',
            }}
          />
          <strong>1ra LLANO</strong> ({unidad})
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: COLOR_WALLYS,
              border: `1px solid ${COLOR_WALLYS_STROKE}`,
              display: 'inline-block',
            }}
          />
          <strong>2da Wallys</strong> ({unidad})
        </span>
      </div>
      <div
        style={{
          overflowX: 'auto',
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <svg
          width={chartW}
          height={chartH}
          viewBox={`0 0 ${chartW} ${chartH}`}
          role="img"
          aria-label={`Calidades por variedad — ${esTonHa ? 'ton/ha' : 'cajas/ha'}`}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padTop + innerH * (1 - t);
            const val = maxVal * t;
            return (
              <g key={t}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={chartW - 8}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text x={4} y={y + 4} fontSize={10} fill="#64748b" fontWeight={600}>
                  {fmtAxis(val)}
                </text>
              </g>
            );
          })}
          {bars.map((b, i) => {
            const hLlano = (b.a / maxVal) * innerH;
            const hWallys = (b.b / maxVal) * innerH;
            const x0 = padLeft + groupGap + i * (groupW + groupGap);
            const xLlano = x0;
            const xWallys = x0 + singleW + pairGap;
            const yBase = padTop + innerH;
            const yLlano = yBase - hLlano;
            const yWallys = yBase - hWallys;
            const active = hover?.variedad === b.variedad;
            const setTip = (e: { clientX: number; clientY: number }) =>
              setHover({ variedad: b.variedad, x: e.clientX, y: e.clientY });
            return (
              <g key={b.variedad}>
                <rect
                  x={x0 - 4}
                  y={padTop}
                  width={groupW + 8}
                  height={innerH + padBottom - 8}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={setTip}
                  onMouseMove={setTip}
                />
                <rect
                  x={xLlano}
                  y={yLlano}
                  width={singleW}
                  height={Math.max(hLlano, b.a > 0 ? 1 : 0)}
                  fill={COLOR_LLANO}
                  stroke={COLOR_LLANO_STROKE}
                  strokeWidth={active ? 2 : 1}
                  rx={4}
                  style={{ pointerEvents: 'none' }}
                />
                <rect
                  x={xWallys}
                  y={yWallys}
                  width={singleW}
                  height={Math.max(hWallys, b.b > 0 ? 1 : 0)}
                  fill={COLOR_WALLYS}
                  stroke={COLOR_WALLYS_STROKE}
                  strokeWidth={active ? 2 : 1}
                  rx={4}
                  style={{ pointerEvents: 'none' }}
                />
                <text
                  x={x0 + groupW / 2}
                  y={chartH - 28}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#1e293b"
                  fontWeight={800}
                  style={{ pointerEvents: 'none' }}
                >
                  {b.variedad}
                </text>
                <text
                  x={x0 + groupW / 2}
                  y={chartH - 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#64748b"
                  style={{ pointerEvents: 'none' }}
                >
                  {fmtVal(b.total)} {unidad}
                </text>
              </g>
            );
          })}
        </svg>

        {tip && hover && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(hover.x + 14, window.innerWidth - 280),
              top: Math.max(8, hover.y - 100),
              zIndex: 50,
              background: '#fff',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
              padding: '10px 12px',
              minWidth: 220,
              maxWidth: 280,
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', marginBottom: 6 }}>
              {tip.title}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8', marginBottom: 3 }}>
              {tip.llano}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 3 }}>
              {tip.wallys}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{tip.total}</div>
          </div>
        )}
      </div>
    </div>
  );
}
