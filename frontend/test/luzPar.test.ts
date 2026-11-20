import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACTOR_PAR_BASE, FACTOR_PAR_MAX, FACTOR_PAR_MIN, factorDeCampo, factorValido } from '../src/estacion/luzPar.ts';

test('el factor de campo es PAR medido entre W/m²', () => {
  assert.equal(factorDeCampo(404, 200), 2.02);
  assert.equal(factorDeCampo(1000, 400), 2.5);
  assert.equal(factorDeCampo(0, 100), 0);
  assert.equal(factorDeCampo(10, 0), null);
  assert.equal(factorDeCampo(10, -5), null);
  assert.equal(factorDeCampo(Number.NaN, 10), null);
});

test('el rango válido del factor es 0.5 a 4.5 y la base es 2.02', () => {
  assert.equal(FACTOR_PAR_BASE, 2.02);
  assert.equal(factorValido(FACTOR_PAR_MIN), true);
  assert.equal(factorValido(FACTOR_PAR_MAX), true);
  assert.equal(factorValido(2.02), true);
  assert.equal(factorValido(0.49), false);
  assert.equal(factorValido(4.51), false);
});
