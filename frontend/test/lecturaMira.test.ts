import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lecturaEnCursor, limitesPaneo } from '../src/estacion/lecturaMira.ts';

const H = 15 * 60 * 1000;

test('la retícula toma la muestra exacta y no interpola', () => {
  const pts = [{ t: 0, y: 10 }, { t: 10 * 60 * 1000, y: 20 }];
  const a = lecturaEnCursor(pts, 0, H);
  const b = lecturaEnCursor(pts, 4 * 60 * 1000, H);
  assert.deepEqual(a, { hay: true, t: 0, y: 10 });
  assert.deepEqual(b, { hay: true, t: 0, y: 10 });
  assert.notEqual(b.hay && b.y, 14);
});

test('un hueco mayor que el ciclo es sin datos', () => {
  const pts = [{ t: 0, y: 10 }, { t: 3 * 60 * 60 * 1000, y: 30 }];
  assert.deepEqual(lecturaEnCursor(pts, 90 * 60 * 1000, H), { hay: false });
  assert.deepEqual(lecturaEnCursor(pts, -H - 1, H), { hay: false });
  assert.deepEqual(lecturaEnCursor([], 0, H), { hay: false });
});

test('el paneo deja el primer y el último instante en el centro', () => {
  const { min, max, ancho } = limitesPaneo(1_000, 11_000);
  assert.equal(ancho, 10_000);
  assert.equal((min + (min + ancho)) / 2, 1_000);
  assert.equal(((max - ancho) + max) / 2, 11_000);
});
