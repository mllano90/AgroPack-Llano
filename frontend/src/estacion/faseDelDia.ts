/** Fase del día en Guaymas, Sonora, con la hora de América/Hermosillo (UTC−7, sin horario de verano).
 *  El cálculo es el de NOAA (siglo juliano, ecuación del tiempo, ángulo horario, cenit 90.833°).
 *  No consulta la red ni la zona del teléfono. */

export const LAT_GUAYMAS = 27.92;
export const LON_GUAYMAS = -110.9;
/** Minutos que se suman a UTC para obtener la hora civil de Hermosillo. */
export const OFFSET_HERMOSILLO_MIN = -7 * 60;

export const FASES_ID = ['noche', 'amanecer', 'manana', 'mediodia', 'atardecer'] as const;
export type FaseId = (typeof FASES_ID)[number];

export type Polvo = 'oro' | 'brasa' | 'luciernaga';

/** Haz anclado a un punto de la foto 720×1280. Misma ficha que la imagen. */
export type Haz = { x: number; y: number; rumbo: number; color: string; pulso: number };

export type EscenaFase = { polvo: Polvo; haz: Haz; cantidad: number };

/** Una sola ficha por fase: la foto, el haz y el polvo salen de aquí. */
export const FASES: Record<FaseId, EscenaFase> = {
  noche: { polvo: 'luciernaga', cantidad: 18, haz: { x: 0.1, y: 0.07, rumbo: 52, color: '186,214,255', pulso: 11 } },
  amanecer: { polvo: 'oro', cantidad: 46, haz: { x: 0.07, y: 0.36, rumbo: 38, color: '255,178,96', pulso: 10 } },
  manana: { polvo: 'oro', cantidad: 48, haz: { x: 0.05, y: 0.08, rumbo: 48, color: '255,224,150', pulso: 9 } },
  mediodia: { polvo: 'oro', cantidad: 48, haz: { x: 0.07, y: 0.05, rumbo: 58, color: '255,236,186', pulso: 10 } },
  atardecer: { polvo: 'brasa', cantidad: 40, haz: { x: 0.91, y: 0.43, rumbo: 196, color: '255,132,64', pulso: 9.5 } },
};

export function esFase(v: string | null | undefined): v is FaseId {
  return !!v && (FASES_ID as readonly string[]).includes(v);
}

export function escenaDe(id: FaseId): EscenaFase {
  return FASES[id];
}

/** Foto + haz + polvo de la misma fase. No hay otra fuente. */
export function unirEscena<F>(id: FaseId, fotos: Record<FaseId, F>) {
  return { id, escena: FASES[id], foto: fotos[id] };
}

export function siguienteFase(id: FaseId): FaseId {
  return FASES_ID[(FASES_ID.indexOf(id) + 1) % FASES_ID.length];
}

const RAD = Math.PI / 180;
const ZENIT = 90.833;

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function diaJuliano(y: number, m: number, d: number) {
  let Y = y, M = m;
  if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + d + B - 1524.5;
}

function longMedia(t: number) {
  return mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
}
function anomalia(t: number) {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}
function excentricidad(t: number) {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}
function centro(t: number) {
  const m = anomalia(t) * RAD;
  return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m) * 0.000289;
}
function longAparente(t: number) {
  const omega = 125.04 - 1934.136 * t;
  return longMedia(t) + centro(t) - 0.00569 - 0.00478 * Math.sin(omega * RAD);
}
function oblicuidad(t: number) {
  const sec = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const e0 = 23 + (26 + sec / 60) / 60;
  const omega = 125.04 - 1934.136 * t;
  return e0 + 0.00256 * Math.cos(omega * RAD);
}
function declinacion(t: number) {
  const e = oblicuidad(t) * RAD;
  const lam = longAparente(t) * RAD;
  return Math.asin(Math.sin(e) * Math.sin(lam)) / RAD;
}
function ecuacionTiempo(t: number) {
  const epsilon = oblicuidad(t) * RAD;
  const l0 = longMedia(t) * RAD;
  const e = excentricidad(t);
  const m = anomalia(t) * RAD;
  let y = Math.tan(epsilon / 2);
  y *= y;
  const E = y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m);
  return (E * 180 / Math.PI) * 4;
}
function anguloHorario(lat: number, dec: number) {
  const lr = lat * RAD, dr = dec * RAD, zr = ZENIT * RAD;
  const h = (Math.cos(zr) - Math.sin(lr) * Math.sin(dr)) / (Math.cos(lr) * Math.cos(dr));
  return Math.acos(Math.max(-1, Math.min(1, h))) * (180 / Math.PI);
}

/** Minutos UTC del orto (true) o del ocaso. Dos pasadas, como la hoja de NOAA. */
function transitoUTC(y: number, m: number, d: number, salida: boolean) {
  const jd = diaJuliano(y, m, d);
  let ajuste = 0;
  let utc = 0;
  for (let i = 0; i < 2; i++) {
    const t = (jd + ajuste - 2451545) / 36525;
    let ang = anguloHorario(LAT_GUAYMAS, declinacion(t));
    if (!salida) ang = -ang;
    const delta = -LON_GUAYMAS - ang;
    let offset = delta * 4 - ecuacionTiempo(t);
    if (offset < -720) offset += 1440;
    utc = 720 + offset;
    ajuste = utc / 1440;
  }
  return utc;
}

export type Sol = { salida: number; puesta: number };

/** Minutos desde la medianoche local de Hermosillo. */
export function solLocal(y: number, m: number, d: number): Sol {
  const aLocal = (utc: number) => mod(utc + OFFSET_HERMOSILLO_MIN, 1440);
  return { salida: aLocal(transitoUTC(y, m, d, true)), puesta: aLocal(transitoUTC(y, m, d, false)) };
}

/** Partes civiles de Hermosillo para un instante absoluto. */
export function partesLocales(fecha: Date) {
  const d = new Date(fecha.getTime() + OFFSET_HERMOSILLO_MIN * 60_000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    min: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60_000,
  };
}

/**
 * Noche: ocaso+45 → orto−45. Amanecer: orto−45 → orto+90.
 * Mañana: hasta las 12:00. Mediodía y tarde: hasta ocaso−90.
 * Atardecer: ocaso−90 → ocaso+45.
 * Los cortes son por el extremo izquierdo: a las 12:00 ya es mediodía.
 */
export function faseDeMinuto(min: number, sol: Sol): FaseId {
  const m = mod(min, 1440);
  const amanecer = sol.salida - 45;
  const manana = sol.salida + 90;
  const mediodia = 12 * 60;
  const atardecer = sol.puesta - 90;
  const noche = sol.puesta + 45;
  if (m >= amanecer && m < manana) return 'amanecer';
  if (m >= manana && m < mediodia) return 'manana';
  if (m >= mediodia && m < atardecer) return 'mediodia';
  if (noche <= 1440) {
    if (m >= atardecer && m < noche) return 'atardecer';
    return 'noche';
  }
  if (m >= atardecer || m < noche - 1440) return 'atardecer';
  return 'noche';
}

export function faseEn(fecha: Date): FaseId {
  const p = partesLocales(fecha);
  return faseDeMinuto(p.min, solLocal(p.y, p.m, p.d));
}

/** Foto 720×1280. La ventana tiene el mismo alto/ancho que la planta del lienzo continuo,
 *  así que al encajarla la planta queda en el mismo rectángulo de siempre. */
export const FOTO_FASE = { w: 720, h: 1280 };
export const VENTANA_FASE = {
  x: 0,
  y: 320,
  w: FOTO_FASE.w,
  h: FOTO_FASE.w * 620 / 710,
};

export function cajaDeFase(planta: { left: number; top: number; width: number; height: number }) {
  const s = planta.width / VENTANA_FASE.w;
  const box = {
    left: planta.left - VENTANA_FASE.x * s,
    top: planta.top - VENTANA_FASE.y * s,
    width: FOTO_FASE.w * s,
    height: FOTO_FASE.h * s,
  };
  const ventana = {
    left: box.left + VENTANA_FASE.x * s,
    top: box.top + VENTANA_FASE.y * s,
    width: VENTANA_FASE.w * s,
    height: VENTANA_FASE.h * s,
  };
  return { s, box, ventana };
}

export type Particula = { x: number; y: number; vx: number; vy: number; r: number; a: number; fase: number; giro: number };

export function crearParticulas(tipo: Polvo, n: number, rng: () => number = Math.random): Particula[] {
  const lista: Particula[] = [];
  for (let i = 0; i < n; i++) {
    const lento = tipo === 'luciernaga';
    lista.push({
      x: rng(),
      y: rng(),
      vx: (rng() - 0.5) * (lento ? 0.006 : 0.012),
      vy: -(lento ? 0.004 + rng() * 0.008 : 0.01 + rng() * 0.02),
      r: lento ? 2.2 + rng() * 2.6 : 1.4 + rng() * 2.2,
      a: lento ? 0.35 + rng() * 0.45 : 0.25 + rng() * 0.45,
      fase: rng() * Math.PI * 2,
      giro: 0.6 + rng() * 1.4,
    });
  }
  return lista;
}

/** Avanza en coordenadas 0–1 de la foto. Un hueco grande no teletransporta el polvo. */
export function avanzarParticulas(ps: Particula[], dt: number) {
  const t = Math.max(0, Math.min(dt, 0.05));
  for (const p of ps) {
    p.x += p.vx * t;
    p.y += p.vy * t;
    if (p.x < 0) p.x += 1;
    if (p.x >= 1) p.x -= 1;
    if (p.y < 0) p.y += 1;
    if (p.y >= 1) p.y -= 1;
  }
}

export type Programador = {
  raf: (cb: (t: number) => void) => number;
  cancel: (id: number) => void;
  oculto: () => boolean;
};

/** Un solo bucle. start() repetido no abre otro. stop() corta el que había. */
export function crearLazo(p: Programador) {
  let activo = false;
  let id = 0;
  let arranques = 0;
  let paso: ((t: number) => void) | null = null;
  const programar = () => {
    if (!activo || p.oculto() || !paso) return;
    id = p.raf(paso);
  };
  return {
    get corriendo() { return activo; },
    get arranques() { return arranques; },
    start(cb: (t: number) => void) {
      if (activo) return;
      activo = true;
      arranques += 1;
      paso = (t: number) => {
        if (!activo) return;
        if (p.oculto()) return;
        cb(t);
        id = p.raf(paso!);
      };
      programar();
    },
    reanudar() { programar(); },
    stop() {
      activo = false;
      paso = null;
      p.cancel(id);
    },
  };
}
