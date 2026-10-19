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

/** Peso de bin de campo melón (kg) — provisional */
export const PESO_BIN_CAMPO_MELON_KG = 250;

/** Superficie total del rancho (ha) para kg/ha acumulado / corrida */
export const HECTAREAS_RANCHO = 64;

/** Superficie por lote de campo (ha) — kg/ha más real en rendimiento por lote */
export const HECTAREAS_POR_LOTE = 8;

/** Ha totales melón (suma catálogo). Preferir API /reports/melon/hectareas. */
export const HECTAREAS_MELON = 216.5;

/** Fallback si un lote no tiene ha en catálogo. */
export const HECTAREAS_POR_LOTE_MELON = 8;

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
    { variedad: 'macrophyla', pct: 60 },
    { variedad: 'volkameriano', pct: 40 },
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

// ——— Melón (presentaciones propias; no comparte con limón) ———

/** Calidad melón */
export type CalidadMelon = 'llano' | 'wallys';

/** Tipo de caja melón */
export type TipoCajaMelon = 'caja_chica_a' | 'caja_normal_b' | 'caja_jumbo_c';

/** Tallas por tipo de caja (calibre / piezas por caja, notación #9s) */
export const TALLAS_MELON_CAJA_A = ['9', '12', '15'] as const; // caja chica
export const TALLAS_MELON_CAJA_B = ['9', '12', '15'] as const; // caja normal
export const TALLAS_MELON_CAJA_C = ['6', '9', '12'] as const; // jumbo

/**
 * Cajas por parrilla/pallet completo (captura de empaque = parrillas).
 * Reportes resumen por cajas = parrillas × este factor.
 */
export const CAJAS_POR_PARRILLA_MELON: Record<TipoCajaMelon, number> = {
  caja_chica_a: 56,
  caja_normal_b: 56,
  caja_jumbo_c: 49,
};

/** Peso por caja melón (kg) — provisional para reportes / t·ha */
export const PESO_CAJA_MELON_KG: Record<TipoCajaMelon, number> = {
  caja_chica_a: 15,
  caja_normal_b: 18,
  caja_jumbo_c: 21,
};

export function cajasPorParrillaMelon(presentacion: string): number {
  return CAJAS_POR_PARRILLA_MELON[presentacion as TipoCajaMelon] || 56;
}

export function pesoCajaMelonKg(presentacion: string): number {
  return PESO_CAJA_MELON_KG[presentacion as TipoCajaMelon] || 18;
}

/** Etiqueta talla + tipo de caja: "#6s Jumbo", "#9s Chica", "#12s Normal". */
export function labelTallaCajaMelon(presentacion: string, talla: string): string {
  const caja =
    presentacion === 'caja_chica_a'
      ? 'Chica'
      : presentacion === 'caja_normal_b'
        ? 'Normal'
        : presentacion === 'caja_jumbo_c'
          ? 'Jumbo'
          : presentacion || 'Caja';
  const t = String(talla || '').replace(/^#/, '').replace(/s$/i, '');
  return t ? `#${t}s ${caja}` : caja;
}

export const FILAS_CAJA_MELON: Array<{
  presentacion: TipoCajaMelon;
  label: string;
  tallas: readonly string[];
  /** Colores lavados — fila dentro de Primera LLANO */
  llano: { rowBg: string; cellBg: string; border: string; title: string };
  /** Colores lavados — fila dentro de Segunda Wallys (café) */
  wallys: { rowBg: string; cellBg: string; border: string; title: string };
}> = [
  {
    presentacion: 'caja_chica_a',
    label: 'Caja chica A',
    tallas: TALLAS_MELON_CAJA_A,
    llano: {
      rowBg: '#f0f9ff',
      cellBg: '#e0f2fe',
      border: '#7dd3fc',
      title: '#0369a1',
    },
    wallys: {
      rowBg: '#fffbeb',
      cellBg: '#fef3c7',
      border: '#fcd34d',
      title: '#92400e',
    },
  },
  {
    presentacion: 'caja_normal_b',
    label: 'Caja normal B',
    tallas: TALLAS_MELON_CAJA_B,
    llano: {
      rowBg: '#f0fdf4',
      cellBg: '#dcfce7',
      border: '#86efac',
      title: '#166534',
    },
    wallys: {
      rowBg: '#fefce8',
      cellBg: '#fde68a',
      border: '#fbbf24',
      title: '#78350f',
    },
  },
  {
    presentacion: 'caja_jumbo_c',
    label: 'Talla jumbo C',
    tallas: TALLAS_MELON_CAJA_C,
    llano: {
      rowBg: '#faf5ff',
      cellBg: '#ede9fe',
      border: '#c4b5fd',
      title: '#5b21b6',
    },
    wallys: {
      rowBg: '#fff7ed',
      cellBg: '#ffedd5',
      border: '#fdba74',
      title: '#9a3412',
    },
  },
];

export function labelPresentacionMelon(p: string): string {
  const map: Record<string, string> = {
    caja_chica_a: 'Caja chica A',
    caja_normal_b: 'Caja normal B',
    caja_jumbo_c: 'Talla jumbo C',
  };
  return map[p] || p;
}

export function labelCalidadMelon(c: string): string {
  if (c === 'llano') return 'Primera LLANO';
  if (c === 'wallys') return 'Segunda Wallys';
  return c;
}

export function tallasParaPresentacionMelon(presentacion: string): readonly string[] {
  const row = FILAS_CAJA_MELON.find((r) => r.presentacion === presentacion);
  return row?.tallas ?? [];
}

// ——— Melón recepción: área → sección → variedad ———

export type AreaMelon = 'rancho' | 'bajio' | 'lomas';

export type VariedadMelonCampo =
  | 'krypto'
  | 'diputado'
  | 'ultra_jelly'
  | 'heidi'
  | 'pruebas';

export const AREAS_MELON: Array<{ value: AreaMelon; label: string }> = [
  { value: 'rancho', label: 'Rancho' },
  { value: 'bajio', label: 'Bajío' },
  { value: 'lomas', label: 'Lomas' },
];

export const VARIEDAD_MELON_LABEL: Record<VariedadMelonCampo, string> = {
  krypto: 'Krypto',
  diputado: 'Diputado',
  ultra_jelly: 'Ultra Jelly',
  heidi: 'Heidi',
  pruebas: 'Pruebas',
};

/** Combinaciones válidas área × sección × variedad (recepción melón) + ha plantadas. */
export const RECEPCION_MELON_OPCIONES: Array<{
  area: AreaMelon;
  seccion: number;
  variedad: VariedadMelonCampo;
  hectareas: number;
}> = [
  // Rancho
  { area: 'rancho', seccion: 4, variedad: 'krypto', hectareas: 35.6 },
  { area: 'rancho', seccion: 5, variedad: 'diputado', hectareas: 15 },
  { area: 'rancho', seccion: 6, variedad: 'diputado', hectareas: 30 },
  { area: 'rancho', seccion: 7, variedad: 'diputado', hectareas: 30 },
  { area: 'rancho', seccion: 8, variedad: 'diputado', hectareas: 53.6 },
  // Bajío
  { area: 'bajio', seccion: 5, variedad: 'diputado', hectareas: 3.7 },
  { area: 'bajio', seccion: 5, variedad: 'heidi', hectareas: 16 },
  { area: 'bajio', seccion: 5, variedad: 'ultra_jelly', hectareas: 1 },
  { area: 'bajio', seccion: 6, variedad: 'ultra_jelly', hectareas: 6 },
  { area: 'bajio', seccion: 7, variedad: 'ultra_jelly', hectareas: 14.5 },
  // Lomas
  { area: 'lomas', seccion: 2, variedad: 'krypto', hectareas: 1.8 },
  { area: 'lomas', seccion: 2, variedad: 'diputado', hectareas: 8 },
  { area: 'lomas', seccion: 2, variedad: 'pruebas', hectareas: 1.3 },
];

/** Total ha melón (suma del catálogo). Preferir API /reports/melon/hectareas. */
export const HECTAREAS_MELON_TOTAL = RECEPCION_MELON_OPCIONES.reduce(
  (s, o) => s + o.hectareas,
  0
);

export function labelAreaMelon(area: AreaMelon | '' | null | undefined): string {
  if (!area) return '';
  return AREAS_MELON.find((a) => a.value === area)?.label || area;
}

export function labelSeccionMelon(seccion: number): string {
  return `Sección ${seccion}`;
}

export function seccionesMelonPorArea(area: AreaMelon): number[] {
  const set = new Set(
    RECEPCION_MELON_OPCIONES.filter((o) => o.area === area).map((o) => o.seccion)
  );
  return [...set].sort((a, b) => a - b);
}

export function variedadesMelonPorAreaSeccion(
  area: AreaMelon,
  seccion: number
): VariedadMelonCampo[] {
  return RECEPCION_MELON_OPCIONES.filter(
    (o) => o.area === area && o.seccion === seccion
  ).map((o) => o.variedad);
}

/** Extrae variedad de un lote melón ("Rancho S5 Diputado" → "Diputado"). */
export function variedadDesdeLoteMelon(lote: string): string {
  const s = (lote || '').trim();
  if (!s) return 'Sin variedad';
  const known = Object.values(VARIEDAD_MELON_LABEL).sort((a, b) => b.length - a.length);
  const lower = s.toLowerCase();
  for (const label of known) {
    const needle = label.toLowerCase();
    if (lower === needle || lower.endsWith(` ${needle}`) || lower.endsWith(needle)) {
      return label;
    }
  }
  const parts = s.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || 'Sin variedad';
}

/** Lote legible: "Rancho S5 Diputado", "Bajío S5 Ultra Jelly", "Lomas S2 Pruebas". */
export function loteMelonCompuesto(
  area: AreaMelon,
  seccion: number,
  variedad: VariedadMelonCampo
): string {
  return `${labelAreaMelon(area)} S${seccion} ${VARIEDAD_MELON_LABEL[variedad]}`;
}

/** Etiqueta de lista: "Bajío Sección 5 Heidi". */
export function labelOpcionRecepcionMelon(
  area: AreaMelon,
  seccion: number,
  variedad: VariedadMelonCampo
): string {
  return `${labelAreaMelon(area)} ${labelSeccionMelon(seccion)} ${VARIEDAD_MELON_LABEL[variedad]}`;
}

/** Lista plana para el select de recepción (área + sección + variedad en una sola opción). */
export const LOTES_MELON = RECEPCION_MELON_OPCIONES.map((o) => ({
  lote: loteMelonCompuesto(o.area, o.seccion, o.variedad),
  label: labelOpcionRecepcionMelon(o.area, o.seccion, o.variedad),
  area: o.area,
  seccion: o.seccion,
  variedad: o.variedad,
  hectareas: o.hectareas,
}));

/** Mapa lote canónico → hectáreas (fallback local si la API no responde). */
export const HECTAREAS_MELON_POR_LOTE: Record<string, number> = Object.fromEntries(
  LOTES_MELON.map((o) => [o.lote, o.hectareas])
);

/** Busca hectáreas de un lote melón (nombre canónico o parcial). */
export function hectareasDesdeLoteMelon(
  lote: string,
  mapa?: Record<string, number> | null
): number | null {
  const source = mapa && Object.keys(mapa).length > 0 ? mapa : HECTAREAS_MELON_POR_LOTE;
  const key = (lote || '').trim();
  if (!key) return null;
  if (source[key] != null) return source[key];
  // Match case-insensitive / sin acento Bajío vs Bajio
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const nk = norm(key);
  for (const [loteName, ha] of Object.entries(source)) {
    if (norm(loteName) === nk) return ha;
  }
  return null;
}
