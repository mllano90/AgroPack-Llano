import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decidirGesto, razonPellizcoVertical } from '../src/estacion/gestosGrafica.ts';

test('un dedo horizontal mueve la lectura y uno vertical deja el scroll', () => {
  assert.equal(decidirGesto(2, 1), 'esperar');
  assert.equal(decidirGesto(20, 4), 'horizontal');
  assert.equal(decidirGesto(4, 20), 'vertical');
  assert.equal(decidirGesto(-30, 10), 'horizontal');
  assert.equal(decidirGesto(10, -30), 'vertical');
});

test('el pellizco vertical cambia la escala y el horizontal no', () => {
  assert.equal(razonPellizcoVertical(40, 10, 30), null);
  const abrir = razonPellizcoVertical(8, 40, 20);
  assert.ok(abrir != null && abrir > 1);
  const cerrar = razonPellizcoVertical(4, 16, 28);
  assert.ok(cerrar != null && cerrar < 1);
});
