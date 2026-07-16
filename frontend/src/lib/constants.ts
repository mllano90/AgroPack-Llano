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

/** Tallas de limón 1ra (campos fijos en empaque) */
export const TALLAS_LIMON = ['75', '95', '115', '140', '165', '200', '235'] as const;

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
  { value: 'rpc_12', label: 'RPC 12 bolsas 2lbs' },
  { value: 'rpc_18', label: 'RPC 18 bolsas 2lbs' },
  { value: 'caja_40lbs', label: 'Caja 40 lbs granel' },
  { value: 'bins_jugo', label: 'Bins 900kg (2da)' },
] as const;
