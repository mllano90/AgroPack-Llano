// Reporte descargable (PDF carta paginado o PNG) armado en el navegador con Chart.js: el servidor solo entrega
// las series agregadas (GET /reporte), así la generación no carga al backend compartido con AgroPack.
import Chart from 'chart.js/auto';
import { huecoMs } from './cadencia';
import type { Punto, Reporte } from './tipos';
import { anotacionesRango, ejeConRango, fmtLimite, fueraDeRango, tieneRango } from './rango';
import { IND } from './indicadores';
import { TZ } from './formato';
import { MARCA, MARCA_FIRMA, MARCA_NOMBRE } from './marca';

export const RANGOS_REPORTE: [string, string][] = [['24h', '1 día'], ['7d', '7 días'], ['30d', '1 mes'], ['365d', '1 año']];
const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour12: false, ...o });
const fLarga = f({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fDiaA = f({ day: '2-digit', month: 'short', year: 'numeric' });
const fHora = f({ hour: '2-digit', minute: '2-digit' });
const fDiaM = f({ day: '2-digit', month: 'short' });
const fArch = (ms: number) => {
  const p = Object.fromEntries(f({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(ms).map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}_${p.hour}${p.minute}`;
};

// Página carta a 200 px/pulgada (8.5 × 11 in)
const W = 1700, H = 2200, M = 110, ANCHO = W - 2 * M;
const VERDE = '#1f8a4c', OSCURO = '#17261d', GRIS = '#5d6b62', LINEA = '#d9e2dc', FONDO_T = '#f3f7f4';
const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const nombreRango = (r: string) => RANGOS_REPORTE.find(x => x[0] === r)?.[1] ?? r;
const dec = (v: string) => IND[v]?.dec ?? 1;
const fmt = (x: number | null | undefined, d: number) => (x == null ? '—' : x.toFixed(d));

function nuevaPagina(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  return [c, g];
}

function texto(g: CanvasRenderingContext2D, t: string, x: number, y: number, tam: number, color = OSCURO, peso = 400, alin: CanvasTextAlign = 'left') {
  g.font = `${peso} ${tam}px ${FUENTE}`; g.fillStyle = color; g.textAlign = alin; g.textBaseline = 'alphabetic';
  g.fillText(t, x, y);
}

/** Encabezado: marca, nombre completo, nodo, rango de fechas y fecha de generación. Devuelve la y siguiente. */
function encabezado(g: CanvasRenderingContext2D, d: Reporte, completo: boolean): number {
  let y = M;
  g.fillStyle = VERDE; g.fillRect(M, y, 12, completo ? 150 : 74);
  texto(g, MARCA, M + 34, y + 56, completo ? 64 : 44, OSCURO, 800);
  if (completo) {
    texto(g, MARCA_NOMBRE, M + 36, y + 100, 30, GRIS, 500);
    texto(g, d.nombre_nodo, M + 36, y + 142, 32, VERDE, 700);
    texto(g, 'Reporte de condiciones del cultivo', W - M, y + 50, 30, OSCURO, 700, 'right');
    texto(g, `Rango: ${nombreRango(d.rango)} · ${fLarga.format(d.desde * 1000)} – ${fLarga.format(d.hasta * 1000)}`, W - M, y + 96, 24, GRIS, 400, 'right');
    texto(g, `Generado: ${fLarga.format(d.generado * 1000)} (hora de Hermosillo, UTC−7)`, W - M, y + 134, 24, GRIS, 400, 'right');
    y += 190;
  } else {
    texto(g, `${MARCA_NOMBRE} · ${d.nombre_nodo}`, M + 36 + 220, y + 54, 26, GRIS, 500);
    texto(g, `${nombreRango(d.rango)} · ${fDiaA.format(d.desde * 1000)} – ${fDiaA.format(d.hasta * 1000)}`, W - M, y + 54, 24, GRIS, 400, 'right');
    y += 104;
  }
  g.fillStyle = LINEA; g.fillRect(M, y - 22, ANCHO, 3);
  return y + 10;
}

function pie(g: CanvasRenderingContext2D, pag: number, tot: number) {
  g.fillStyle = LINEA; g.fillRect(M, H - M + 10, ANCHO, 2);
  texto(g, `${MARCA} · ${MARCA_NOMBRE}`, M, H - M + 50, 22, GRIS, 600);
  texto(g, MARCA_FIRMA, W / 2, H - M + 50, 22, GRIS, 400, 'center');
  if (tot > 0) texto(g, `Página ${pag} de ${tot}`, W - M, H - M + 50, 22, GRIS, 400, 'right');
}

/** Tabla resumen mín/prom/máx por parámetro. */
function tabla(g: CanvasRenderingContext2D, d: Reporte, y: number): number {
  texto(g, 'Resumen del periodo', M, y + 30, 32, OSCURO, 700);
  y += 56;
  const cols: [string, number, CanvasTextAlign][] = [['Parámetro', M + 20, 'left'], ['Unidad', M + 440, 'left'], ['Mínimo', M + 720, 'right'],
    ['Promedio', M + 870, 'right'], ['Máximo', M + 1010, 'right'], ['Rango ideal', M + 1210, 'right'], ['En rango', M + 1340, 'right'],
    ['Lecturas', ANCHO + M - 20, 'right']];
  const fila = 58;
  g.fillStyle = VERDE; g.fillRect(M, y, ANCHO, fila);
  cols.forEach(([t, x, a]) => texto(g, t, x, y + 38, 24, '#fff', 700, a));
  y += fila;
  d.orden.forEach((v, i) => {
    const x = d.variables[v], r = x.resumen, dd = dec(v);
    if (i % 2) { g.fillStyle = FONDO_T; g.fillRect(M, y, ANCHO, fila); }
    const um = x.umbral, NAR = '#c2410c';
    texto(g, IND[v]?.nombre ?? x.nombre, cols[0][1], y + 38, 25, OSCURO, 600);
    texto(g, x.unidad || '—', cols[1][1], y + 38, 24, GRIS);
    texto(g, fmt(r?.min, dd), cols[2][1], y + 38, 25, r && fueraDeRango(r.min, um) ? NAR : OSCURO, 400, 'right');
    texto(g, fmt(r?.prom, dd), cols[3][1], y + 38, 25, r && fueraDeRango(r.prom, um) ? NAR : OSCURO, 700, 'right');
    texto(g, fmt(r?.max, dd), cols[4][1], y + 38, 25, r && fueraDeRango(r.max, um) ? NAR : OSCURO, 400, 'right');
    const tr = !tieneRango(um) ? '—' : um.min != null && um.max != null ? `${fmtLimite(um.min, dd)}–${fmtLimite(um.max, dd)}`
      : um.min != null ? `≥ ${fmtLimite(um.min, dd)}` : `≤ ${fmtLimite(um.max!, dd)}`;
    texto(g, tr, cols[5][1], y + 38, 23, GRIS, 400, 'right');
    const pr = r?.en_rango_pct;
    texto(g, pr == null ? '—' : `${Math.round(pr)} %`, cols[6][1], y + 38, 24, pr != null && pr < 80 ? NAR : OSCURO, 600, 'right');
    texto(g, r ? r.n.toLocaleString('es-MX') : 'sin datos', cols[7][1], y + 38, 24, GRIS, 400, 'right');
    y += fila;
  });
  g.strokeStyle = LINEA; g.lineWidth = 2; g.strokeRect(M, y - fila * (d.orden.length + 1), ANCHO, fila * (d.orden.length + 1));
  const fuente = d.fuente === 'hora' ? 'agregados horarios' : 'datos crudos';
  texto(g, `Intervalo de cada punto: ${d.paso_s >= 3600 ? d.paso_s / 3600 + ' h' : d.paso_s / 60 + ' min'} (${fuente}). ` +
    'En naranja: fuera del rango ideal configurado. Suelo y NPK solo con lecturas nuevas.', M, y + 40, 21, GRIS);
  texto(g, 'Rango ideal: líneas discontinuas Mín/Máx en cada gráfica. "En rango": % de lecturas cuyo intervalo promedió dentro del rango.',
    M, y + 72, 21, GRIS);
  return y + 108;
}

/** Gráfica de línea de tiempo de una variable, dibujada en la página en (x, y, w, h). */
function grafica(g: CanvasRenderingContext2D, d: Reporte, v: string, x: number, y: number, w: number, h: number) {
  const info = d.variables[v], def = IND[v], u = info.unidad, color = def?.color ?? VERDE;
  const largo = d.rango === '7d' || d.rango === '30d' || d.rango === '365d';
  const r = info.resumen;
  g.fillStyle = '#fff'; g.strokeStyle = LINEA; g.lineWidth = 2;
  g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill(); g.stroke();
  texto(g, `${def?.nombre ?? info.nombre}${u ? ` (${u})` : ''}`, x + 24, y + 44, 28, OSCURO, 700);
  const angosto = w < 1000, arriba = angosto ? 92 : 58;
  const est = r ? `mín ${fmt(r.min, dec(v))} · prom ${fmt(r.prom, dec(v))} · máx ${fmt(r.max, dec(v))}${u ? ' ' + u : ''}` : '';
  if (r) angosto ? texto(g, est, x + 24, y + 78, 21, GRIS) : texto(g, est, x + w - 24, y + 44, 22, GRIS, 400, 'right');
  const cw = w - 30, ch = h - arriba - 12;
  if (!info.puntos.length) {
    g.setLineDash([10, 8]); g.strokeRect(x + 24, y + arriba + 4, w - 48, ch - 16); g.setLineDash([]);
    texto(g, 'Sin datos en este rango', x + w / 2, y + arriba + ch / 2, 26, GRIS, 400, 'center');
    return;
  }
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const hueco = huecoMs(v, d.paso_s);   // CE/pH/NPK y suelo: línea continua entre muestreos (cadencia.ts)
  const xy = (p: Punto[], k: 'prom' | 'min' | 'max') => p.map(q => ({ x: q.t * 1000, y: q[k] }));
  const ds: any[] = [];
  if (largo) {
    ds.push({ label: 'máx', data: xy(info.puntos, 'max'), borderColor: 'transparent', pointRadius: 0, fill: false, spanGaps: hueco });
    ds.push({ label: 'Mín–máx', data: xy(info.puntos, 'min'), borderColor: 'transparent', backgroundColor: color + '30', pointRadius: 0, fill: '-1', spanGaps: hueco });
  }
  ds.push({ label: def?.extras ? 'Promedio' : (largo ? 'Promedio' : def?.corto ?? v), data: xy(info.puntos, 'prom'), borderColor: color,
    borderWidth: 3, pointRadius: info.puntos.length < 30 ? 4 : 0, pointBackgroundColor: color, fill: false, tension: .25, showLine: true, spanGaps: hueco });
  (def?.extras ?? []).forEach(e => info.extras[e.v]?.length && ds.push({ label: e.nombre, data: xy(info.extras[e.v], 'prom'),
    borderColor: e.color, borderWidth: 1.6, borderDash: [8, 6], pointRadius: 0, fill: false, tension: .25, spanGaps: hueco }));
  const fx = d.rango === '24h' ? (ms: number) => fHora.format(ms) : (ms: number) => fDiaM.format(ms);
  const tick = { color: GRIS, font: { size: 19, family: FUENTE } };
  // marcas alineadas a horas/días locales de Hermosillo (UTC−7 fijo)
  const OFF = 7 * 3600 * 1000, HORA = 3600 * 1000, DIA = 24 * HORA;
  const salto = { '24h': 3 * HORA, '7d': DIA, '30d': 5 * DIA, '365d': 30 * DIA }[d.rango] ?? DIA;
  const marcas = () => {
    const out: { value: number }[] = [];
    const a = d.desde * 1000, b = d.hasta * 1000;
    let m = Math.ceil((a - OFF) / salto) * salto + OFF;
    if (d.rango === '365d') m = Math.ceil((a - OFF) / DIA) * DIA + OFF;
    for (; m <= b; m += salto) out.push({ value: m });
    return out;
  };
  const ch1 = new Chart(c, {
    type: 'line', data: { datasets: ds },
    options: {
      responsive: false, animation: false, parsing: false, devicePixelRatio: 1,
      layout: { padding: { right: 12 } },
      scales: {
        x: { type: 'linear', min: d.desde * 1000, max: d.hasta * 1000, grid: { color: '#edf1ee' },
          afterBuildTicks: sc => { sc.ticks = marcas(); },
          ticks: { ...tick, autoSkip: false, maxRotation: 0, callback: val => fx(Number(val)) },
          title: { display: true, text: d.rango === '24h' ? 'Hora (Hermosillo)' : 'Fecha (Hermosillo)', ...tick } },
        y: { ...ejeConRango(info.umbral), grid: { color: '#edf1ee' }, ticks: tick, title: { display: true, text: u || v.toUpperCase(), ...tick } },
      },
      plugins: {
        annotation: { annotations: anotacionesRango(info.umbral, u, dec(v), { banda: d.rango_banda !== false, claro: true, letra: 18, grosor: 2.5 }) },
        legend: { display: ds.length > 1, position: 'top', align: 'end',
          labels: { color: OSCURO, font: { size: 18, family: FUENTE }, boxWidth: 22, filter: it => it.text !== 'máx' } },
        tooltip: { enabled: false },
      },
    },
  });
  g.drawImage(c, x + 12, y + arriba);
  ch1.destroy();
}

const ALTO_G = 430, SEP = 34;

/** Arma las páginas carta: 1) encabezado + tabla + gráficas que quepan; siguientes: 4 gráficas por página. */
export function paginas(d: Reporte): HTMLCanvasElement[] {
  const pags: HTMLCanvasElement[] = [];
  let [c, g] = nuevaPagina();
  let y = tabla(g, d, encabezado(g, d, true));
  pags.push(c);
  for (const v of d.orden) {
    if (y + ALTO_G > H - M - 20) {
      [c, g] = nuevaPagina(); pags.push(c);
      y = encabezado(g, d, false);
    }
    grafica(g, d, v, M, y, ANCHO, ALTO_G);
    y += ALTO_G + SEP;
  }
  pags.forEach((p, i) => pie(p.getContext('2d')!, i + 1, pags.length));
  return pags;
}

/** PNG: una sola imagen larga (encabezado, tabla y todas las gráficas en dos columnas). */
export function imagenPng(d: Reporte): HTMLCanvasElement {
  const colW = (ANCHO - SEP) / 2, altoG = 400;
  const filas = Math.ceil(d.orden.length / 2);
  // medir la altura de encabezado + tabla en un lienzo de prueba
  const [, gp] = nuevaPagina();
  const yTabla = tabla(gp, d, encabezado(gp, d, true));
  const alto = yTabla + filas * (altoG + SEP) + 130;
  const c = document.createElement('canvas');
  c.width = W; c.height = alto;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, alto);
  let y = tabla(g, d, encabezado(g, d, true));
  d.orden.forEach((v, i) => {
    grafica(g, d, v, M + (i % 2) * (colW + SEP), y, colW, altoG);
    if (i % 2) y += altoG + SEP;
  });
  if (d.orden.length % 2) y += altoG + SEP;
  g.fillStyle = LINEA; g.fillRect(M, alto - 90, ANCHO, 2);
  texto(g, `${MARCA} · ${MARCA_NOMBRE}`, M, alto - 50, 22, GRIS, 600);
  texto(g, MARCA_FIRMA, W - M, alto - 50, 22, GRIS, 400, 'right');
  return c;
}

export function nombreArchivo(d: Reporte, ext: string) {
  return `${MARCA.replace(/\s+/g, '')}_reporte_${d.nodo}_${d.rango}_${fArch(d.generado * 1000)}.${ext}`;
}

/** Genera el archivo en el formato elegido y devuelve { blob, nombre }. jsPDF se carga solo al pedir PDF. */
export async function generarReporte(d: Reporte, formato: 'pdf' | 'png'): Promise<{ blob: Blob; nombre: string }> {
  if (formato === 'png') {
    const c = imagenPng(d);
    const blob = await new Promise<Blob>((ok, mal) => c.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo crear la imagen'))), 'image/png'));
    return { blob, nombre: nombreArchivo(d, 'png') };
  }
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  pdf.setProperties({ title: `${MARCA} – Reporte ${nombreRango(d.rango)} – ${d.nombre_nodo}`, author: `${MARCA_NOMBRE} (${MARCA_FIRMA})`,
    subject: 'Reporte de condiciones del cultivo', creator: MARCA });
  paginas(d).forEach((p, i) => {
    if (i) pdf.addPage('letter', 'portrait');
    pdf.addImage(p.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 612, 792, undefined, 'FAST');
  });
  return { blob: pdf.output('blob'), nombre: nombreArchivo(d, 'pdf') };
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
