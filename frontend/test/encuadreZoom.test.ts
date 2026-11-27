import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anclaEnCursor, seguirPunto, zoomEnAncla } from '../src/estacion/encuadreZoom.ts';

const LIM = { min: 0, max: 100 };
const dentro = (r: { min: number; max: number }, y: number) => y >= r.min - 1e-6 && y <= r.max + 1e-6;
const span = (r: { min: number; max: number }) => r.max - r.min;

test('un registro alto sigue en el encuadre al acercar 2× y 4×', () => {
  const alto = 82;
  const x2 = zoomEnAncla({ min: 0, max: 100 }, alto, 2, LIM);
  const x4 = zoomEnAncla({ min: 0, max: 100 }, alto, 4, LIM);
  assert.ok(Math.abs(span(x2) - 50) < 1e-6);
  assert.ok(Math.abs(span(x4) - 25) < 1e-6);
  assert.ok(dentro(x2, alto) && dentro(x4, alto));
  assert.ok(x2.min >= 0 && x2.max <= 100 && x4.min >= 0 && x4.max <= 100);
  // El zoom al 50 % del eje (25–75 y 37.5–62.5) dejaría 82 fuera.
  assert.ok(x2.min > 25);
  assert.ok(Math.abs((x4.min + x4.max) / 2 - alto) < 1e-6);
});

test('un registro bajo sigue en el encuadre al acercar 2× y 4×', () => {
  const bajo = 7;
  const x2 = zoomEnAncla({ min: 0, max: 100 }, bajo, 2, LIM);
  const x4 = zoomEnAncla({ min: 0, max: 100 }, bajo, 4, LIM);
  assert.ok(dentro(x2, bajo) && dentro(x4, bajo));
  assert.ok(Math.abs(span(x2) - 50) < 1e-6 && Math.abs(span(x4) - 25) < 1e-6);
  assert.equal(x2.min, 0);
  assert.equal(x4.min, 0);
  assert.ok(x2.max < 75);
});

test('varias series usan el punto medio de los valores bajo la línea', () => {
  const series = [
    { pts: [{ t: 1_000, y: 70 }, { t: 2_000, y: 10 }], huecoMs: 5_000 },
    { pts: [{ t: 1_000, y: 90 }, { t: 2_000, y: 40 }], huecoMs: 5_000 },
  ];
  assert.equal(anclaEnCursor(series, 1_000), 80);
  const zoom = zoomEnAncla({ min: 0, max: 100 }, 80, 2, LIM);
  assert.ok(dentro(zoom, 70) && dentro(zoom, 90));
});

test('con zoom, al deslizar a un valor más bajo el encuadre lo sigue sin cambiar el span', () => {
  const zoom = { min: 60, max: 90 };
  assert.deepEqual(seguirPunto(zoom, 75, LIM), zoom);
  const bajo = seguirPunto(zoom, 15, LIM);
  assert.ok(Math.abs(span(bajo) - span(zoom)) < 1e-6);
  assert.ok(dentro(bajo, 15));
  assert.ok(bajo.min >= 0 && bajo.max <= 100);
  assert.ok(bajo.max < zoom.min);
});

test('87 % con zoom deja el eje en 100 como máximo', () => {
  const r = zoomEnAncla({ min: 0, max: 100 }, 87, 2, LIM);
  assert.equal(r.max, 100);
  assert.ok(r.min >= 0);
  assert.ok(Math.abs(span(r) - 50) < 1e-6);
  assert.ok(dentro(r, 87));
  const mas = zoomEnAncla(r, 87, 1.3, LIM);
  assert.equal(mas.max, 100);
  assert.ok(dentro(mas, 87));
  assert.ok(mas.min > r.min);
});

test('un hueco usa el valor cercano, no el 50 % del eje', () => {
  const series = [{ pts: [{ t: 0, y: 85 }, { t: 100_000, y: 8 }], huecoMs: 1_000 }];
  const ancla = anclaEnCursor(series, 4_000, { tMin: 0, tMax: 20_000 });
  assert.equal(ancla, 85);
  assert.notEqual(ancla, 50);
  assert.equal(anclaEnCursor([], 0), null);
});
