// Catálogo de indicadores de Inicio: variable de /historial, textos, unidad, decimales e icono.
export interface DefIndicador {
  v: string; nombre: string; corto: string; /** etiqueta para pantallas angostas */ mini?: string; unidad: string; dec: number; icono: string; color: string;
  /** Series extra que se dibujan en la ventana emergente (p. ej. Aire 1 / Aire 2 bajo el promedio). */
  extras?: { v: string; nombre: string; color: string }[];
}

export const IND: Record<string, DefIndicador> = {
  t_aire: { v: 't_aire', nombre: 'Temperatura del aire', corto: 'Temperatura', mini: 'Temp.', unidad: '°C', dec: 1, icono: 'termo', color: '#ffb020',
    extras: [{ v: 't1', nombre: 'Aire 1', color: '#ff7a59' }, { v: 't2', nombre: 'Aire 2', color: '#ffd23d' }] },
  h_aire: { v: 'h_aire', nombre: 'Humedad del aire', corto: 'Humedad', mini: 'Hum.', unidad: '%', dec: 0, icono: 'gota', color: '#2ea8ff',
    extras: [{ v: 'h1', nombre: 'Aire 1', color: '#69d7ff' }, { v: 'h2', nombre: 'Aire 2', color: '#a58bff' }] },
  pir: { v: 'pir', nombre: 'Radiación solar', corto: 'Radiación', mini: 'Rad.', unidad: 'W/m²', dec: 0, icono: 'sol', color: '#ffd23d' },
  t_caja: { v: 't_caja', nombre: 'Temp. caja', corto: 'Temp. caja', mini: 'Caja', unidad: '°C', dec: 1, icono: 'termo', color: '#ff8f5a' },
  h_caja: { v: 'h_caja', nombre: 'Hum. caja', corto: 'Hum. caja', mini: 'Hum. caja', unidad: '%', dec: 0, icono: 'gota', color: '#5bb8ff' },
  h_suelo: { v: 'h_suelo', nombre: 'Humedad del suelo', corto: 'Humedad', mini: 'Hum.', unidad: '%', dec: 0, icono: 'gota', color: '#2ea8ff' },
  t_suelo: { v: 't_suelo', nombre: 'Temperatura del suelo', corto: 'Temperatura', mini: 'Temp.', unidad: '°C', dec: 1, icono: 'termo', color: '#ff7a59' },
  ec: { v: 'ec', nombre: 'Conductividad eléctrica (CE)', corto: 'CE', unidad: 'dS/m', dec: 2, icono: 'ec', color: '#2fe07a' },
  ph: { v: 'ph', nombre: 'pH del suelo', corto: 'pH', unidad: '', dec: 1, icono: 'ph', color: '#b07cff' },
  n: { v: 'n', nombre: 'Nitrógeno (N)', corto: 'N', unidad: 'mg/kg', dec: 0, icono: 'npk', color: '#2fe07a' },
  p: { v: 'p', nombre: 'Fósforo (P)', corto: 'P', unidad: 'mg/kg', dec: 0, icono: 'npk', color: '#ff9a1f' },
  k: { v: 'k', nombre: 'Potasio (K)', corto: 'K', unidad: 'mg/kg', dec: 0, icono: 'npk', color: '#c77dff' },
};

/** Rangos de la ventana emergente (claves de RANGOS en estacion/servicio.py). */
export const RANGOS_MODAL: [string, string][] = [['8h', '8 h'], ['24h', '24 h'], ['7d', '7 días'], ['30d', '1 mes']];
