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
