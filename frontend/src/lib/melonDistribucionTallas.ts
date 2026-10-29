/**
 * Distribución de kg por talla del reporte de melón.
 * Usa las mismas corridas que las tarjetas del acumulado.
 */

export type FiltroAcumuladoMelon = {
  tipo: 'todos' | 'variedad' | 'corrida';
  variedad?: string;
  corridaIds?: string[];
};

export type LineaDistribucion = {
  presentacion?: string;
  talla?: string | null;
  cantidad?: number;
  calidad?: string;
};

export type EmpaqueDistribucion = {
  id?: number;
  producto?: string | null;
  detalle_corrida?: unknown;
};

export type TallaAgg = {
  label: string;
  presentacion: string;
  talla: string;
  cajas: number;
  kg: number;
  llano: number;
  wallys: number;
};

type Detalle = {
  consumos?: Array<{ lote?: string }>;
  produccion?: LineaDistribucion[];
  tipo?: string | null;
  anulado?: boolean;
  lotes_resumen?: string;
};

/** Corrida de campo de melón. Reempaque y anulados no entran al acumulado. */
export function esProcesoCampoMelon(e: EmpaqueDistribucion): boolean {
  if (String(e.producto || '').toLowerCase() !== 'melon') return false;
  const det = parseDetalleMelon(e.detalle_corrida);
  if (det.anulado) return false;
  return String(det.tipo || '').toLowerCase() !== 'reempaque_melon';
}

/** Lotes de la corrida: consumos, o el resumen si no hay consumos. */
export function lotesDeEmpaqueMelon(
  e: EmpaqueDistribucion & { lote_desverdizado?: string | null }
): string[] {
  const det = parseDetalleMelon(e.detalle_corrida);
  const fromConsumos = (det.consumos || [])
    .map((c) => String(c.lote || '').trim())
    .filter(Boolean);
  if (fromConsumos.length > 0) return [...new Set(fromConsumos)];
  const resumen = String(det.lotes_resumen || e.lote_desverdizado || '').trim();
  return resumen
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDetalleMelon(raw: unknown): Detalle {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Detalle;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Detalle;
  return {};
}

/** Misma selección que las tarjetas: todo, una variedad o corridas. */
export function filtrarProcesosAcumulado<T extends { id: number }>(
  procesos: T[],
  lotesDe: (p: T) => string[],
  filtro: FiltroAcumuladoMelon,
  variedadDeLote: (lote: string) => string
): T[] {
  if (filtro.tipo === 'todos') return procesos;
  if (filtro.tipo === 'corrida') {
    const ids = (filtro.corridaIds || [])
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) return [];
    const set = new Set(ids);
    return procesos.filter((p) => set.has(p.id));
  }
  const variedad = (filtro.variedad || '').trim();
  if (!variedad) return procesos;
  return procesos.filter((p) =>
    lotesDe(p).some((lote) => variedadDeLote(lote) === variedad)
  );
}

function tallaSimple(raw: string | null | undefined): string {
  return String(raw || '')
    .replace(/^#/, '')
    .replace(/s$/i, '')
    .trim();
}

/**
 * Suma cajas y kg de las líneas de esos empaques.
 * Una línea sin talla entra como "Sin talla" para que el total
 * coincida con los kg de las tarjetas (LLANO + Wallys).
 */
export function agregarDistribucionTallas(
  empaques: EmpaqueDistribucion[],
  pesoKg: (presentacion: string, talla?: string | null) => number,
  vista: 'simple' | 'tipos_caja'
): TallaAgg[] {
  const map = new Map<string, TallaAgg>();
  for (const e of empaques) {
    const det = parseDetalleMelon(e.detalle_corrida);
    for (const p of det.produccion || []) {
      const pres = String(p.presentacion || '');
      const cajas = Number(p.cantidad) || 0;
      if (cajas <= 0) continue;
      const tallaRaw = tallaSimple(p.talla);
      const kg = cajas * pesoKg(pres, p.talla);
      const esWallys = String(p.calidad || '').toLowerCase() === 'wallys';

      let key: string;
      let label: string;
      let talla: string;
      let presentacion: string;
      if (vista === 'simple') {
        talla = tallaRaw;
        presentacion = '';
        label = talla ? `#${talla}s` : 'Sin talla';
        key = talla || '__sin_talla';
      } else {
        presentacion = pres;
        talla = tallaRaw;
        if (!pres) {
          label = talla ? `#${talla}s Sin tipo` : 'Sin tipo';
          key = `__sin_tipo|${talla}`;
        } else {
          const caja =
            pres === 'caja_chica_a'
              ? 'Chica'
              : pres === 'caja_normal_b'
                ? 'Normal'
                : pres === 'caja_jumbo_c'
                  ? 'Jumbo'
                  : pres;
          label = talla ? `#${talla}s ${caja}` : caja;
          key = `${pres}|${talla}`;
        }
      }

      const prev = map.get(key) || {
        label,
        presentacion,
        talla,
        cajas: 0,
        kg: 0,
        llano: 0,
        wallys: 0,
      };
      prev.cajas += cajas;
      prev.kg += kg;
      if (esWallys) prev.wallys += kg;
      else prev.llano += kg;
      map.set(key, prev);
    }
  }

  const rows = [...map.values()];
  if (vista === 'simple') {
    rows.sort((a, b) => {
      const na = Number(a.talla) || 0;
      const nb = Number(b.talla) || 0;
      if (!a.talla && b.talla) return 1;
      if (a.talla && !b.talla) return -1;
      if (na !== nb) return na - nb;
      return b.kg - a.kg;
    });
    return rows;
  }
  return rows.sort((a, b) => b.kg - a.kg);
}

export function sumaKgTallas(rows: TallaAgg[]): {
  kg: number;
  llano: number;
  wallys: number;
  cajas: number;
} {
  return rows.reduce(
    (s, r) => ({
      kg: s.kg + r.kg,
      llano: s.llano + r.llano,
      wallys: s.wallys + r.wallys,
      cajas: s.cajas + r.cajas,
    }),
    { kg: 0, llano: 0, wallys: 0, cajas: 0 }
  );
}
