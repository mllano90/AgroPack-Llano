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
 * - Cartón (caja 40 lbs): 75, 95, 115 y 140
 * - RPC: 140, 165, 200, 235
 * - Solo la 140 se empaca en ambos (cartón o RPC)
 */
export const TALLAS_CARTON = ['75', '95', '115', '140'] as const;
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

export const PRESENTACIONES_LIMON = [
  { value: 'rpc_granel', label: 'RPC a granel 22 kg (por talla, 1ra en proceso)' },
  { value: 'rpc_18', label: 'RPC 18 bolsas 2lbs (tallas 140+)' },
  { value: 'rpc_12', label: 'RPC 12 bolsas 2lbs (tallas 140+)' },
  { value: 'caja_40lbs', label: 'Caja 40 lbs granel (tallas ≤140)' },
  { value: 'bins_jugo', label: 'Bins 900kg (2da)' },
] as const;

/** Producto final (salida de conversión desde RPC a granel) */
export const PRESENTACIONES_FINAL_LIMON = [
  { value: 'rpc_18', label: 'RPC 18 bolsas 2lbs (tallas 140+)' },
  { value: 'rpc_12', label: 'RPC 12 bolsas 2lbs (tallas 140+)' },
  { value: 'caja_40lbs', label: 'Caja 40 lbs granel (tallas ≤140)' },
] as const;
