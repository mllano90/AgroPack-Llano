/**
 * Cajas de las tarjetas de melón.
 *
 * Producidas = inventario final que sigue en stock + lo ya embarcado.
 * Así, si no salió nada, las tarjetas igualan el conteo de producto final.
 * Una alta o un embarque sin lote entra al total y se muestra como "sin lote".
 * El registro de reempaque no se suma aparte: su resultado ya está en el inventario.
 */
import { cajasPorParrillaMelon, variedadDesdeLoteMelon } from './constants.ts';
import { kgPorBin, porcentajesQueSuman100 } from '../components/Reportes/melonKpi.ts';
import {
  agregarDistribucionTallas,
  esProcesoCampoMelon,
  parseDetalleMelon,
  type EmpaqueDistribucion,
  type TallaAgg,
} from './melonDistribucionTallas.ts';

export const SIN_LOTE = 'sin lote';

const PRESENTACIONES_MELON = new Set(['caja_chica_a', 'caja_normal_b', 'caja_jumbo_c']);

export type LineaCajaMelon = {
  lote: string;
  presentacion: string;
  talla: string | null;
  calidad: 'llano' | 'wallys';
  cajas: number;
};

export type InventarioCaja = {
  producto?: string | null;
  cantidad_stock?: number | null;
  presentacion?: string | null;
  talla?: string | null;
  calidad?: string | null;
  lote?: string | null;
};

export type EmbarqueCaja = {
  estado?: string | null;
  detalles?: Array<{
    producto?: string | null;
    presentacion?: string | null;
    talla?: string | null;
    calidad?: string | null;
    cantidad_cajas?: number | null;
  }> | null;
};

export type KpiCajasMelon = {
  cajasLlano: number;
  cajasWallys: number;
  cajasTotal: number;
  kgLlano: number;
  kgWallys: number;
  kgTotal: number;
  parrillas: number;
  bins: number;
  pctLlano: number;
  pctWallys: number;
  tonHa: number;
  cajasHa: number;
  cajasLlanoHa: number;
  cajasWallysHa: number;
  kgLlanoHa: number;
  kgWallysHa: number;
  binsPorParr: number | null;
  kgBinLlano: number | null;
  kgBinWallys: number | null;
  kgBinTotal: number | null;
  hectareas: number;
};

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

export function calidadMelon(raw: unknown): 'llano' | 'wallys' {
  return norm(raw) === 'wallys' ? 'wallys' : 'llano';
}

export function esPresentacionMelon(pres: unknown): boolean {
  return PRESENTACIONES_MELON.has(String(pres ?? '').trim());
}

/**
 * Caja de melón. Un embarque a veces queda con producto limón
 * porque la captura manda la presentación; la caja chica/normal/jumbo es melón.
 */
export function esCajaProductoMelon(producto: unknown, presentacion: unknown): boolean {
  const p = norm(producto);
  if (p === 'melon') return true;
  if (p === 'limon_amarillo' || p === 'uva' || p === '') return esPresentacionMelon(presentacion);
  return false;
}

export function lineasProducidasMelon(
  inventario: InventarioCaja[] | null | undefined,
  embarques: EmbarqueCaja[] | null | undefined
): LineaCajaMelon[] {
  const out: LineaCajaMelon[] = [];
  for (const item of inventario || []) {
    if (norm(item.producto) !== 'melon') continue;
    const cajas = Number(item.cantidad_stock) || 0;
    if (cajas <= 0) continue;
    const talla = String(item.talla ?? '').trim();
    out.push({
      lote: String(item.lote ?? '').trim(),
      presentacion: String(item.presentacion ?? '').trim(),
      talla: talla || null,
      calidad: calidadMelon(item.calidad),
      cajas,
    });
  }
  for (const emb of embarques || []) {
    if (norm(emb.estado) === 'anulado') continue;
    for (const d of emb.detalles || []) {
      if (!esCajaProductoMelon(d?.producto, d?.presentacion)) continue;
      const cajas = Number(d?.cantidad_cajas) || 0;
      if (cajas <= 0) continue;
      const talla = String(d?.talla ?? '').trim();
      out.push({
        // embarque_detalle no guarda lote: no se inventa uno
        lote: '',
        presentacion: String(d?.presentacion ?? '').trim(),
        talla: talla || null,
        calidad: calidadMelon(d?.calidad),
        cajas,
      });
    }
  }
  return out;
}

export function variedadDeLinea(lote: string): string {
  const l = String(lote || '').trim();
  if (!l) return SIN_LOTE;
  return variedadDesdeLoteMelon(l);
}

/** Todo, o una variedad. "sin lote" no se mezcla con los lotes de campo. */
export function filtrarLineasPorVariedad(
  lineas: LineaCajaMelon[],
  variedad: string
): LineaCajaMelon[] {
  const v = variedad.trim();
  if (!v) return lineas;
  if (v === SIN_LOTE) return lineas.filter((l) => !String(l.lote || '').trim());
  return lineas.filter((l) => variedadDeLinea(l.lote) === v);
}

export function binsDeProceso(
  e: EmpaqueDistribucion & { bins_desverdizado_usados?: number | null }
): number {
  if (!esProcesoCampoMelon(e)) return 0;
  const det = parseDetalleMelon(e.detalle_corrida) as {
    consumos?: Array<{ bins?: number }>;
  };
  const desdeConsumos = (det.consumos || []).reduce((s, c) => s + (Number(c.bins) || 0), 0);
  return desdeConsumos || Number(e.bins_desverdizado_usados) || 0;
}

export function kpiDesdeLineas(
  lineas: LineaCajaMelon[],
  bins: number,
  ha: number,
  pesoKg: (presentacion: string, talla?: string | null) => number
): KpiCajasMelon {
  let cajasLlano = 0;
  let cajasWallys = 0;
  let kgLlano = 0;
  let kgWallys = 0;
  let parrillas = 0;
  for (const ln of lineas) {
    const cajas = Number(ln.cajas) || 0;
    if (cajas <= 0) continue;
    const kg = cajas * pesoKg(ln.presentacion, ln.talla);
    const cpp = cajasPorParrillaMelon(ln.presentacion);
    parrillas += cpp > 0 ? cajas / cpp : 0;
    if (ln.calidad === 'wallys') {
      cajasWallys += cajas;
      kgWallys += kg;
    } else {
      cajasLlano += cajas;
      kgLlano += kg;
    }
  }
  const kgTotal = kgLlano + kgWallys;
  const cajasTotal = cajasLlano + cajasWallys;
  const pct = porcentajesQueSuman100(kgLlano, kgWallys);
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
    pctLlano: pct.primera,
    pctWallys: pct.segunda,
    tonHa: haSafe > 0 ? kgTotal / 1000 / haSafe : 0,
    cajasHa: haSafe > 0 ? cajasTotal / haSafe : 0,
    cajasLlanoHa: haSafe > 0 ? cajasLlano / haSafe : 0,
    cajasWallysHa: haSafe > 0 ? cajasWallys / haSafe : 0,
    kgLlanoHa: haSafe > 0 ? kgLlano / haSafe : 0,
    kgWallysHa: haSafe > 0 ? kgWallys / haSafe : 0,
    binsPorParr,
    kgBinLlano: kgPorBin(kgLlano, bins),
    kgBinWallys: kgPorBin(kgWallys, bins),
    kgBinTotal: kgPorBin(kgTotal, bins),
    hectareas: haSafe,
  };
}

/** Misma distribución de tallas que las tarjetas (inventario + embarcado). */
export function distribucionDesdeLineas(
  lineas: LineaCajaMelon[],
  pesoKg: (presentacion: string, talla?: string | null) => number,
  vista: 'simple' | 'tipos_caja'
): TallaAgg[] {
  return agregarDistribucionTallas(
    [
      {
        producto: 'melon',
        detalle_corrida: {
          produccion: lineas.map((ln) => ({
            presentacion: ln.presentacion,
            talla: ln.talla,
            cantidad: ln.cajas,
            calidad: ln.calidad,
          })),
        },
      },
    ],
    pesoKg,
    vista
  );
}
