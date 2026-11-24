/**
 * Seis indicadores del reporte de productos picosos (chiles del catálogo).
 *
 * El % de primera y de segunda es sobre los kilos de campo que los empaques
 * del periodo consumieron, no sobre lo recibido ni sobre el pendiente.
 * Bins por parrilla = bins consumidos ÷ (parrillas de 1ra + parrillas de 2da).
 * Cada parrilla sale de cajas ÷ cajas_por_parrilla de esa presentación.
 * Kg efectivos por bin = (kg 1ra + kg 2da) ÷ bins consumidos.
 * Tolva por bin = peso teórico del bin − kg efectivos, nunca negativo.
 * Ton/ha queda reservada mientras el cultivo no tenga hectáreas > 0.
 *
 * Tomatillo no usa este tablero. Limón y melón tampoco pasan por aquí.
 */

export interface PresentacionPicoso {
  cajas?: number | null;
  cajasPorParrilla?: number | null;
}

export interface PicososKpiInput {
  kgPrimera?: number | null;
  kgSegunda?: number | null;
  kgConsumido?: number | null;
  binsConsumidos?: number | null;
  presentaciones?: PresentacionPicoso[] | null;
  hectareas?: number | null;
  pesoTeoricoBinKg?: number | null;
}

export interface PicososIndicadores {
  pctPrimera: number | null;
  kgPrimera: number;
  pctSegunda: number | null;
  kgSegunda: number;
  kgConsumido: number;
  binsPorParrilla: number | null;
  parrillas: number;
  binsConsumidos: number;
  tonPorHa: number | null;
  toneladasEmpacadas: number;
  hectareas: number | null;
  hectareasReservadas: boolean;
  kgEfectivosPorBin: number | null;
  tolvaPorBin: number | null;
  /** true solo cuando el empacado superó el peso teórico y se acotó a 0. */
  tolvaAcotadaEnCero: boolean;
  pesoTeoricoBinKg: number | null;
}

export interface FormaPeso {
  codigo?: string | null;
  peso_kg?: number | null;
}

export interface FormaConsumo {
  codigo?: string | null;
  consumidos?: number | null;
}

export interface PresentacionReporteMin {
  cajas?: number | null;
  cajas_por_parrilla?: number | null;
}

/** Minúsculas, sin acentos ni espacios extremos. "Tomátillo" y "TOMATILLO" coinciden. */
export function normalizarClave(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** true si el código o el nombre, ya normalizados, contienen "tomatillo". */
export function esTomatillo(
  codigo: string | null | undefined,
  nombre: string | null | undefined
): boolean {
  return normalizarClave(codigo).includes('tomatillo') || normalizarClave(nombre).includes('tomatillo');
}

/**
 * Tablero de 6 tarjetas para cualquier producto del catálogo que no sea Tomatillo.
 * Así entra Jalapeño, Caribe, Anaheim, Serrano, Fresno, Shishito y un Poblano futuro.
 */
export function usaDashboardPicosos(
  codigo: string | null | undefined,
  nombre: string | null | undefined
): boolean {
  return !esTomatillo(codigo, nombre);
}

function numeroFinito(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return n;
}

function numeroNoNegativo(valor: unknown): number {
  const n = numeroFinito(valor);
  if (n == null || n < 0) return 0;
  return n;
}

function numeroPositivo(valor: unknown): number | null {
  const n = numeroFinito(valor);
  if (n == null || n <= 0) return null;
  return n;
}

/**
 * Peso teórico del bin de campo.
 * Primero `producto_formas_cosecha` con código bins; si esa forma no trae peso,
 * `productos_catalogo.peso_contenedor_kg`. Nunca un número fijo por producto.
 */
export function pesoTeoricoBinKg(
  formas: FormaPeso[] | null | undefined,
  pesoContenedorKg: number | null | undefined
): number | null {
  for (const forma of formas ?? []) {
    if (normalizarClave(forma.codigo) !== 'bins') continue;
    const peso = numeroPositivo(forma.peso_kg);
    if (peso != null) return peso;
  }
  return numeroPositivo(pesoContenedorKg);
}

/** Solo la forma `bins`. Cajas de campo u otras formas no cuentan como bin. */
export function binsConsumidosDeFormas(formas: FormaConsumo[] | null | undefined): number {
  let total = 0;
  for (const forma of formas ?? []) {
    if (normalizarClave(forma.codigo) !== 'bins') continue;
    total += numeroNoNegativo(forma.consumidos);
  }
  return total;
}

/** Parrillas de 1ra y de 2da: cada presentación aporta cajas ÷ cajas por parrilla. */
export function parrillasDePresentaciones(
  presentaciones: PresentacionPicoso[] | null | undefined
): number {
  let total = 0;
  for (const p of presentaciones ?? []) {
    const cajas = numeroNoNegativo(p.cajas);
    const cpp = numeroPositivo(p.cajasPorParrilla);
    if (cpp == null || !(cajas > 0)) continue;
    total += cajas / cpp;
  }
  return total;
}

/** null si no hay kilos consumidos: no se muestra 0% cuando no hubo empaque. */
export function porcentajeSobreConsumido(kgCalidad: number, kgConsumido: number): number | null {
  const den = numeroNoNegativo(kgConsumido);
  if (!(den > 0)) return null;
  return (numeroNoNegativo(kgCalidad) / den) * 100;
}

/**
 * Bins de campo consumidos entre parrillas empacadas (1ra + 2da).
 * null si no hay bins o no hay parrillas.
 */
export function rendimientoBinsPorParrilla(bins: number, parrillas: number): number | null {
  const b = numeroNoNegativo(bins);
  const p = numeroNoNegativo(parrillas);
  if (!(b > 0) || !(p > 0)) return null;
  return b / p;
}

/** (kg primera + kg segunda) / bins consumidos. null si no hubo bins. */
export function kgEfectivosPorBin(
  kgPrimera: number,
  kgSegunda: number,
  bins: number
): number | null {
  const b = numeroNoNegativo(bins);
  if (!(b > 0)) return null;
  return (numeroNoNegativo(kgPrimera) + numeroNoNegativo(kgSegunda)) / b;
}

/**
 * Kilos a tolva por bin. Si el empacado supera el peso teórico, queda en 0
 * (una medición por encima del bin no se muestra como merma negativa).
 * null si falta el peso teórico o no hay bins de donde sacar el efectivo.
 */
export function productoTolvaPorBin(
  pesoTeorico: number | null,
  kgEfectivos: number | null
): { kgPorBin: number | null; acotadoEnCero: boolean } {
  const peso = numeroPositivo(pesoTeorico);
  // null no es cero: sin bins o sin peso teórico no hay estimación de tolva.
  if (peso == null || kgEfectivos == null) {
    return { kgPorBin: null, acotadoEnCero: false };
  }
  const efectivo = numeroFinito(kgEfectivos);
  if (efectivo == null || efectivo < 0) {
    return { kgPorBin: null, acotadoEnCero: false };
  }
  const bruto = peso - efectivo;
  // Polvo de punto flotante (190 − 190.0000001) no es una merma negativa real.
  if (bruto < -1e-6) return { kgPorBin: 0, acotadoEnCero: true };
  if (bruto < 0) return { kgPorBin: 0, acotadoEnCero: false };
  return { kgPorBin: bruto, acotadoEnCero: false };
}

export function toneladasPorHectarea(
  kgPrimera: number,
  kgSegunda: number,
  hectareas: number | null | undefined
): { reservada: boolean; tonPorHa: number | null; toneladas: number; hectareas: number | null } {
  const kg = numeroNoNegativo(kgPrimera) + numeroNoNegativo(kgSegunda);
  const toneladas = kg / 1000;
  const ha = numeroPositivo(hectareas);
  if (ha == null) {
    return { reservada: true, tonPorHa: null, toneladas, hectareas: null };
  }
  if (!(toneladas > 0)) {
    return { reservada: false, tonPorHa: null, toneladas: 0, hectareas: ha };
  }
  return { reservada: false, tonPorHa: toneladas / ha, toneladas, hectareas: ha };
}

export function indicadoresPicosos(input: PicososKpiInput): PicososIndicadores {
  const kgPrimera = numeroNoNegativo(input.kgPrimera);
  const kgSegunda = numeroNoNegativo(input.kgSegunda);
  const kgConsumido = numeroNoNegativo(input.kgConsumido);
  const binsConsumidos = numeroNoNegativo(input.binsConsumidos);
  const parrillas = parrillasDePresentaciones(input.presentaciones);
  const peso = numeroPositivo(input.pesoTeoricoBinKg);
  const ton = toneladasPorHectarea(kgPrimera, kgSegunda, input.hectareas);
  const kgEfectivos = kgEfectivosPorBin(kgPrimera, kgSegunda, binsConsumidos);
  const tolva = productoTolvaPorBin(peso, kgEfectivos);
  return {
    pctPrimera: porcentajeSobreConsumido(kgPrimera, kgConsumido),
    kgPrimera,
    pctSegunda: porcentajeSobreConsumido(kgSegunda, kgConsumido),
    kgSegunda,
    kgConsumido,
    binsPorParrilla: rendimientoBinsPorParrilla(binsConsumidos, parrillas),
    parrillas,
    binsConsumidos,
    tonPorHa: ton.tonPorHa,
    toneladasEmpacadas: ton.toneladas,
    hectareas: ton.hectareas,
    hectareasReservadas: ton.reservada,
    kgEfectivosPorBin: kgEfectivos,
    tolvaPorBin: tolva.kgPorBin,
    tolvaAcotadaEnCero: tolva.acotadoEnCero,
    pesoTeoricoBinKg: peso,
  };
}

export interface ReportePicosoMinimo {
  kg_primera?: number | null;
  kg_segunda?: number | null;
  kg_consumido?: number | null;
  hectareas?: number | null;
  peso_contenedor_kg?: number | null;
  formas?: FormaPeso[] | null;
  por_forma?: FormaConsumo[] | null;
  por_presentacion_primera?: PresentacionReporteMin[] | null;
  por_presentacion_segunda?: PresentacionReporteMin[] | null;
}

/** Arma las 6 tarjetas con el JSON que ya devuelve el reporte de catálogo. */
export function indicadoresDesdeReporte(rep: ReportePicosoMinimo): PicososIndicadores {
  const presentaciones = [
    ...(rep.por_presentacion_primera ?? []),
    ...(rep.por_presentacion_segunda ?? []),
  ].map((p) => ({
    cajas: p.cajas,
    cajasPorParrilla: p.cajas_por_parrilla,
  }));
  return indicadoresPicosos({
    kgPrimera: rep.kg_primera,
    kgSegunda: rep.kg_segunda,
    kgConsumido: rep.kg_consumido,
    binsConsumidos: binsConsumidosDeFormas(rep.por_forma),
    presentaciones,
    hectareas: rep.hectareas,
    pesoTeoricoBinKg: pesoTeoricoBinKg(rep.formas, rep.peso_contenedor_kg),
  });
}

export function textoPorcentaje(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return pct.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Kilos, o toneladas cuando el apoyo ya pasa de 1 t, para no agrandar la tarjeta. */
export function textoKilosDeApoyo(kg: number): string {
  if (!Number.isFinite(kg)) return '—';
  if (Math.abs(kg) >= 1000) {
    const t = kg / 1000;
    return `${t.toLocaleString('en-US', { maximumFractionDigits: 2 })} t`;
  }
  return `${kg.toLocaleString('en-US', { maximumFractionDigits: 1 })} kg`;
}

export function textoRendimiento(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function textoKgBin(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function textoTonHa(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function textoPesoTeoricoBin(peso: number | null): string {
  if (peso == null || !Number.isFinite(peso) || peso <= 0) return 'Sin peso teórico de bin';
  const texto = peso.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `Peso teórico bin: ${texto} kg`;
}

export function textoNotaHectareas(ind: Pick<
  PicososIndicadores,
  'hectareasReservadas' | 'tonPorHa' | 'toneladasEmpacadas' | 'hectareas'
>): string {
  if (ind.hectareasReservadas) return 'Hectáreas por cultivo en desarrollo';
  if (ind.tonPorHa == null) return 'Sin toneladas empacadas';
  const t = ind.toneladasEmpacadas.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const ha = (ind.hectareas ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${t} t · ${ha} ha`;
}

export function textoDetalleParrilla(ind: Pick<PicososIndicadores, 'binsConsumidos' | 'parrillas'>): string {
  if (!(ind.binsConsumidos > 0)) return 'Sin bins consumidos';
  if (!(ind.parrillas > 0)) return 'Sin parrillas empacadas';
  const bins = ind.binsConsumidos.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const parr = ind.parrillas.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${bins} bins · ${parr} parr.`;
}

export function textoDetalleBins(bins: number): string {
  if (!(bins > 0)) return 'Sin bins consumidos';
  const texto = bins.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${texto} bins consumidos`;
}
