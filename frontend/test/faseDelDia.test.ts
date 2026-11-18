import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  FASES, FASES_ID, VENTANA_FASE, avanzarParticulas, cajaDeFase, crearLazo, crearParticulas,
  escenaDe, esFase, faseDeMinuto, faseEn, siguienteFase, solLocal, unirEscena,
} from '../src/estacion/faseDelDia.ts';

const cerca = (v: number, esp: number, tol = 0.2) => assert.ok(Math.abs(v - esp) < tol, `${v} ≠ ${esp}`);

test('orto y ocaso de Guaymas en tres fechas', () => {
  // Referencia astral (mismo lugar): 17-nov 06:46/17:29, 21-jun 05:28/19:22, 21-dic 07:10/17:32.
  const nov = solLocal(2026, 11, 17);
  const jun = solLocal(2026, 6, 21);
  const dic = solLocal(2026, 12, 21);
  cerca(nov.salida, 406.71); cerca(nov.puesta, 1050.21);
  cerca(jun.salida, 328.07); cerca(jun.puesta, 1162.91);
  cerca(dic.salida, 430.63); cerca(dic.puesta, 1053.03);
  assert.ok(jun.puesta - jun.salida > nov.puesta - nov.salida);
  assert.ok(dic.salida > nov.salida);
});

test('fases del 17 de noviembre, 21 de junio y 21 de diciembre', () => {
  const herm = (y: number, m: number, d: number, h: number, min: number) =>
    faseEn(new Date(Date.UTC(y, m - 1, d, h + 7, min)));
  assert.equal(herm(2026, 11, 17, 6, 0), 'noche');
  assert.equal(herm(2026, 11, 17, 6, 10), 'amanecer');
  assert.equal(herm(2026, 11, 17, 8, 20), 'manana');
  assert.equal(herm(2026, 11, 17, 12, 0), 'mediodia');
  assert.equal(herm(2026, 11, 17, 16, 10), 'atardecer');
  assert.equal(herm(2026, 11, 17, 18, 20), 'noche');
  assert.equal(herm(2026, 6, 21, 4, 30), 'noche');
  assert.equal(herm(2026, 6, 21, 5, 0), 'amanecer');
  assert.equal(herm(2026, 6, 21, 12, 0), 'mediodia');
  assert.equal(herm(2026, 6, 21, 19, 0), 'atardecer');
  assert.equal(herm(2026, 6, 21, 20, 30), 'noche');
  assert.equal(herm(2026, 12, 21, 6, 20), 'noche');
  assert.equal(herm(2026, 12, 21, 7, 0), 'amanecer');
  assert.equal(herm(2026, 12, 21, 8, 50), 'manana');
  assert.equal(herm(2026, 12, 21, 18, 30), 'noche');
});

test('los cortes usan el sol calculado y la hora no depende de la zona del proceso', () => {
  const sol = solLocal(2026, 11, 17);
  assert.equal(faseDeMinuto(sol.salida - 45, sol), 'amanecer');
  assert.equal(faseDeMinuto(sol.salida - 45 - 0.01, sol), 'noche');
  assert.equal(faseDeMinuto(sol.salida + 90, sol), 'manana');
  assert.equal(faseDeMinuto(12 * 60, sol), 'mediodia');
  assert.equal(faseDeMinuto(sol.puesta - 90, sol), 'atardecer');
  assert.equal(faseDeMinuto(sol.puesta + 45, sol), 'noche');
  assert.equal(faseDeMinuto(sol.puesta + 45 - 0.01, sol), 'atardecer');
  assert.equal(faseEn(new Date(Date.UTC(2026, 10, 17, 19, 0, 0))), 'mediodia');
});

test('un ocaso que pasa de medianoche sigue en atardecer y luego noche', () => {
  const sol = { salida: 400, puesta: 1420 };
  assert.equal(faseDeMinuto(1410, sol), 'atardecer');
  assert.equal(faseDeMinuto(10, sol), 'atardecer');
  assert.equal(faseDeMinuto(30, sol), 'noche');
  assert.equal(faseDeMinuto(1430, sol), 'atardecer');
});

test('la foto y el haz salen de la misma ficha', () => {
  const fotos = Object.fromEntries(FASES_ID.map(id => [id, { archivo: id + '.avif' }])) as Record<typeof FASES_ID[number], { archivo: string }>;
  for (const id of FASES_ID) {
    const u = unirEscena(id, fotos);
    assert.equal(u.id, id);
    assert.equal(u.escena, escenaDe(id));
    assert.equal(u.escena, FASES[id]);
    assert.equal(u.foto.archivo, id + '.avif');
    assert.ok(u.escena.haz.x >= 0 && u.escena.haz.x <= 1);
    assert.ok(u.escena.haz.y >= 0 && u.escena.haz.y <= 1);
    assert.ok(u.escena.cantidad >= 18 && u.escena.cantidad <= 60);
    assert.equal(esFase(id), true);
  }
  assert.equal(esFase('dia'), false);
  assert.equal(siguienteFase('atardecer'), 'noche');
  assert.equal(siguienteFase('noche'), 'amanecer');
});

test('la ventana de la foto cae exactamente sobre la planta de siempre', () => {
  const planta = { left: 2, top: 253, width: 386, height: 386 * 620 / 710 };
  const { ventana, box } = cajaDeFase(planta);
  cerca(ventana.left, planta.left, 1e-6);
  cerca(ventana.top, planta.top, 1e-6);
  cerca(ventana.width, planta.width, 1e-6);
  cerca(ventana.height, planta.height, 1e-6);
  assert.ok(box.width >= planta.width && box.height > planta.height);
  assert.ok(Math.abs(VENTANA_FASE.w / VENTANA_FASE.h - 710 / 620) < 1e-9);
});

test('el lazo no se duplica, se pausa oculto y se corta al parar', () => {
  const cola: Array<(t: number) => void> = [];
  let oculto = false;
  let cancelados = 0;
  const lazo = crearLazo({
    raf: (cb) => { cola.push(cb); return cola.length; },
    cancel: () => { cancelados += 1; },
    oculto: () => oculto,
  });
  let n = 0;
  lazo.start(() => { n += 1; });
  lazo.start(() => { n += 1; });
  assert.equal(lazo.arranques, 1);
  assert.equal(cola.length, 1);
  cola.shift()!(16);
  assert.equal(n, 1);
  assert.equal(cola.length, 1);
  oculto = true;
  cola.shift()!(32);
  assert.equal(n, 1);
  assert.equal(cola.length, 0);
  oculto = false;
  lazo.reanudar();
  assert.equal(cola.length, 1);
  lazo.stop();
  assert.equal(lazo.corriendo, false);
  assert.equal(cancelados, 1);
  cola.shift()?.(48);
  assert.equal(n, 1);
  lazo.start(() => { n += 1; });
  assert.equal(lazo.arranques, 2);
  lazo.stop();
});

test('el polvo sigue dentro de la foto y un hueco no lo dispara', () => {
  const ps = crearParticulas('oro', 48, () => 0.5);
  const antes = ps.map(p => ({ ...p }));
  avanzarParticulas(ps, 0.016);
  assert.ok(ps.some((p, i) => p.y !== antes[i].y));
  avanzarParticulas(ps, 10);
  for (const p of ps) {
    assert.ok(p.x >= 0 && p.x < 1);
    assert.ok(p.y >= 0 && p.y < 1);
  }
  assert.equal(crearParticulas('luciernaga', 18, () => 0.2).length, 18);
});

test('la caja se abre desde Configuración y el texto de ambiente coincide con el código', () => {
  const cfg = readFileSync('src/estacion/ConfigNodo.tsx', 'utf8');
  const escena = readFileSync('src/estacion/EscenaFondo.tsx', 'utf8');
  const hist = readFileSync('src/estacion/Historial.tsx', 'utf8');
  assert.match(cfg, /setHist\(IND\.t_caja\)/);
  assert.match(cfg, /setHist\(IND\.h_caja\)/);
  assert.match(cfg, /ModalHistorial/);
  assert.doesNotMatch(cfg, /Tinte cálido|Solo CSS/);
  assert.match(cfg, /también se animan en el teléfono/);
  assert.match(cfg, /todas las pestañas/);
  const app = readFileSync('src/estacion/EstacionApp.tsx', 'utf8');
  assert.equal((app.match(/<EscenaFondo/g) || []).length, 1);
  assert.doesNotMatch(readFileSync('src/estacion/Inicio.tsx', 'utf8'), /EscenaFondo/);
  assert.match(cfg, /segundo plano/);
  assert.match(escena, /document\.hidden/);
  assert.match(escena, /en-pausa/);
  assert.match(hist, /t_caja/);
  assert.match(hist, /h_caja/);
  assert.doesNotMatch(readFileSync('src/estacion/Inicio.tsx', 'utf8'), /IND\.t_caja|IND\.h_caja/);
});

test('la escena usa una ficha y apaga el bucle al desmontarse', () => {
  const src = readFileSync('src/estacion/EscenaFondo.tsx', 'utf8');
  const inicio = readFileSync('src/estacion/Inicio.tsx', 'utf8');
  assert.equal((src.match(/unirEscena\(/g) || []).length, 1);
  assert.match(src, /lazo\.stop\(\)/);
  assert.doesNotMatch(src, /setInterval\(/);
  assert.doesNotMatch(inicio, /CapaAmbiente|capa-ambiente/);
});
