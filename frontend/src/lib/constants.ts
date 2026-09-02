import type { Variedad, TipoMercado, TipoCultivo } from '../types';

// Centralized options for selects (single source of truth)

export const VARIEDADES: Array<{ value: Variedad; label: string }> = [
  { value: 'early_sweet', label: 'Early Sweet' },
  { value: 'flame', label: 'Flame' },
  { value: 'summer_royal', label: 'Summer Royal' },
];

export const MERCADO_OPTIONS: Array<{ value: TipoMercado; label: string }> = [
  { value: 'nacional', label: 'Mercado Nacional' },
  { value: 'exportacion', label: 'Mercado Exportación' },
];

export const TIPO_CULTIVO_OPTIONS: Array<{ value: TipoCultivo; label: string }> = [
  { value: 'organica', label: 'Orgánica' },
  { value: 'convencional', label: 'Convencional' },
];

/** Peso de bin de campo limón (kg) */
export const PESO_BIN_CAMPO_KG = 260;

/** Superficie total del rancho (ha) para kg/ha acumulado / corrida */
export const HECTAREAS_RANCHO = 64;

/** Superficie por lote de campo (ha) — kg/ha más real en rendimiento por lote */
export const HECTAREAS_POR_LOTE = 8;

/** Días de desverdizado limón (fecha tentativa = recepción + N) */
export const DIAS_DESVERDIZADO = 7;

/**
 * Tallas limón 1ra por presentación:
 * - Cartón (caja 40 lbs): 75, 95, 115, 140, 165 y 200
 * - RPC: 140, 165, 200, 235
 * - 140 / 165 / 200 pueden ir en cartón o RPC (elige presentación)
 */
export const TALLAS_CARTON = ['75', '95', '115', '140', '165', '200'] as const;
export const TALLAS_RPC = ['140', '165', '200', '235'] as const;
/** Unión (compat / reportes) */
export const TALLAS_LIMON = ['75', '95', '115', '140', '165', '200', '235'] as const;

export type TallaLimon = (typeof TALLAS_LIMON)[number];

/** Peso kg por presentación limón */
export const KG_POR_PRESENTACION: Record<string, number> = {
  rpc_12: 12,
  rpc_18: 18,
  caja_40lbs: 18,
  rpc_granel: 22,
  bins_jugo: 900,
};

export function tallasParaPresentacion(presentacion: string): readonly string[] {
  if (presentacion === 'caja_40lbs') return TALLAS_CARTON;
  if (presentacion === 'rpc_12' || presentacion === 'rpc_18') return TALLAS_RPC;
  // RPC a granel: ya viene sorteado por tamaño (todas las tallas 1ra)
  if (presentacion === 'rpc_granel') return TALLAS_LIMON;
  // bins_jugo: sin talla
  return [];
}

export function esPresentacionRpc(presentacion: string | null | undefined): boolean {
  return presentacion === 'rpc_12' || presentacion === 'rpc_18';
}

export function esPresentacionCarton(presentacion: string | null | undefined): boolean {
  return presentacion === 'caja_40lbs';
}

export function esPresentacionGranel(presentacion: string | null | undefined): boolean {
  return presentacion === 'rpc_granel';
}

export function labelPresentacionLimon(p: string): string {
  const map: Record<string, string> = {
    rpc_12: 'RPC 12',
    rpc_18: 'RPC 18',
    caja_40lbs: 'Caja 40 lbs',
    rpc_granel: 'RPC a granel (22 kg)',
    bins_jugo: 'Bins jugo 900 kg',
  };
  return map[p] || p;
}

/** Lotes de campo predefinidos (recepción / desverdizado) */
export const LOTES_LIMON = [
  '8503 S1C1',
  '8504 S1C2',
  '8505 S1C3',
  '8506 S1C4',
  '8507 S1C5',
  '8500 S2C1',
  '8501 S2C2',
  '8502 S2C3',
] as const;

/** Variedades limón (portainjerto / combinación) para gráficas por lote */
export type VariedadLimonCampo =
  | 'lisboa_macrophyla'
  | 'eureka_macrophyla'
  | 'lisboa_volkameriano'
  | 'volkameriano'
  | 'macrophyla';

export const VARIEDAD_LIMON_LABEL: Record<VariedadLimonCampo, string> = {
  lisboa_macrophyla: 'Lisboa Macrophyla',
  eureka_macrophyla: 'Eureka Macrophyla',
  lisboa_volkameriano: 'Lisboa Volkameriano',
  volkameriano: 'Volkameriano',
  macrophyla: 'Macrophyla',
};

/** Color fijo por variedad (barras apiladas) */
export const VARIEDAD_LIMON_COLOR: Record<VariedadLimonCampo, string> = {
  lisboa_macrophyla: '#15803d', // verde
  eureka_macrophyla: '#2563eb', // azul
  lisboa_volkameriano: '#ca8a04', // ámbar
  volkameriano: '#7c3aed', // violeta
  macrophyla: '#ea580c', // naranja
};

export type MixVariedadPct = { variedad: VariedadLimonCampo; pct: number };

/**
 * Mix de variedades por sección/cuadro (S1C1…S2C3).
 * pct en 0–100; la suma por sección debe ser 100.
 */
export const MIX_VARIEDAD_POR_SECCION: Record<string, MixVariedadPct[]> = {
  S1C1: [{ variedad: 'lisboa_macrophyla', pct: 100 }],
  S1C2: [
    { variedad: 'eureka_macrophyla', pct: 70 },
    { variedad: 'lisboa_macrophyla', pct: 30 },
  ],
  S1C3: [
    { variedad: 'lisboa_macrophyla', pct: 70 },
    { variedad: 'lisboa_volkameriano', pct: 30 },
  ],
  S1C4: [{ variedad: 'lisboa_volkameriano', pct: 100 }],
  S1C5: [{ variedad: 'lisboa_volkameriano', pct: 100 }],
  S2C1: [
    { variedad: 'volkameriano', pct: 85 },
    { variedad: 'lisboa_volkameriano', pct: 15 },
  ],
  S2C2: [{ variedad: 'volkameriano', pct: 100 }],
  S2C3: [
    { variedad: 'volkameriano', pct: 70 },
    { variedad: 'macrophyla', pct: 30 },
  ],
};

/** Extrae código de sección (S1C2, S2C3…) del nombre de lote, p.ej. "8504 S1C2". */
export function seccionDesdeLote(lote: string | null | undefined): string | null {
  const s = String(lote || '').toUpperCase();
  const m = s.match(/\b(S[12]C[1-5])\b/);
  return m ? m[1] : null;
}

export function mixVariedadParaLote(lote: string | null | undefined): MixVariedadPct[] {
  const sec = seccionDesdeLote(lote);
  if (!sec) return [];
  return MIX_VARIEDAD_POR_SECCION[sec] || [];
}

export const PRESENTACIONES_LIMON = [
  { value: 'rpc_granel', label: 'RPC a granel 22 kg (por talla, 1ra en proceso)' },
  { value: 'rpc_18', label: 'RPC 18 bolsas 2lbs (tallas 140+)' },
  { value: 'rpc_12', label: 'RPC 12 bolsas 2lbs (tallas 140+)' },
  { value: 'caja_40lbs', label: 'Caja 40 lbs granel (tallas 75–200)' },
  { value: 'bins_jugo', label: 'Bins 900kg (2da)' },
] as const;

/** Producto final (salida de conversión desde RPC a granel) */
export const PRESENTACIONES_FINAL_LIMON = [
  { value: 'rpc_18', label: 'RPC 18 bolsas 2lbs (tallas 140+)' },
  { value: 'rpc_12', label: 'RPC 12 bolsas 2lbs (tallas 140+)' },
  { value: 'caja_40lbs', label: 'Caja 40 lbs granel (tallas 75–200)' },
] as const;
