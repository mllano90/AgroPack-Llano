import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  binsConsumidosDeFormas,
  esTomatillo,
  indicadoresDesdeReporte,
  indicadoresPicosos,
  pesoTeoricoBinKg,
  productoTolvaPorBin,
  textoKilosDeApoyo,
  textoNotaHectareas,
  textoPesoTeoricoBin,
  textoPorcentaje,
  textoSubtituloTolva,
  usaDashboardPicosos,
  type PicososKpiInput,
} from '../src/components/Reportes/picososKpi.ts';

const cerca = (valor: number | null, esperado: number, msg: string) => {
  assert.ok(valor != null && Number.isFinite(valor), `${msg}: ${valor}`);
  assert.ok(Math.abs(valor - esperado) < 1e-9, `${msg}: ${valor} ≠ ${esperado}`);
};

function caso(parcial: PicososKpiInput): PicososKpiInput {
  return {
    kgPrimera: 0,
    kgSegunda: 0,
    kgConsumido: 0,
    binsConsumidos: 0,
    presentaciones: [],
    hectareas: null,
    pesoTeoricoBinKg: null,
    ...parcial,
  };
}

test('el tablero aplica a los chiles y no a tomatillo', () => {
  const picosos: Array<[string, string]> = [
    ['jalapeno', 'Jalapeño'],
    ['caribe', 'Caribe'],
    ['anaheim', 'Anaheim'],
    ['poblano', 'Poblano'],
    ['fresno', 'Fresno'],
    ['serrano', 'Serrano'],
    ['shishito', 'Shishito'],
    ['chile_nuevo', 'Chile nuevo'],
  ];
  for (const [codigo, nombre] of picosos) {
    assert.equal(usaDashboardPicosos(codigo, nombre), true, nombre);
    assert.equal(esTomatillo(codigo, nombre), false, nombre);
  }

  assert.equal(usaDashboardPicosos('tomatillo', 'Tomatillo'), false);
  assert.equal(usaDashboardPicosos('TOMATILLO', ' tomatillo '), false);
  assert.equal(usaDashboardPicosos('tomatillo', 'Jalapeño'), false);
  assert.equal(usaDashboardPicosos('jalapeno', 'Tomatillo'), false);
  assert.equal(usaDashboardPicosos('tomátillo', 'Tomátillo'), false);
  assert.equal(esTomatillo('mi_tomatillo', 'Chile'), true);
  assert.equal(usaDashboardPicosos('mi_tomatillo', 'Chile'), false);
});

test('jalapeño 190 kg/bin: las seis tarjetas sobre lo consumido', () => {
  const ind = indicadoresPicosos(caso({
    kgPrimera: 2200,
    kgSegunda: 760,
    kgConsumido: 20 * 190,
    binsConsumidos: 20,
    presentaciones: [
      { cajas: 220, cajasPorParrilla: 40 },
      { cajas: 76, cajasPorParrilla: 40 },
    ],
    hectareas: null,
    pesoTeoricoBinKg: 190,
  }));
  cerca(ind.pctPrimera, (2200 / 3800) * 100, '% 1ra');
  cerca(ind.pctSegunda, (760 / 3800) * 100, '% 2da');
  assert.ok(Math.abs((ind.pctPrimera ?? 0) + (ind.pctSegunda ?? 0) - 100) > 1, 'no suman 100: hay merma');
  cerca(ind.parrillas, 220 / 40 + 76 / 40, 'parrillas 1ra+2da');
  cerca(ind.binsPorParrilla, 20 / (5.5 + 1.9), 'bins/parrilla');
  assert.equal(ind.hectareasReservadas, true);
  assert.equal(ind.tonPorHa, null);
  assert.equal(textoNotaHectareas(ind), 'Hectáreas por cultivo en desarrollo');
  cerca(ind.kgEfectivosPorBin, (2200 + 760) / 20, 'kg/bin');
  cerca(ind.tolvaPorBin, 190 - 148, 'tolva');
  cerca(ind.tolvaPorcentaje, (42 / 190) * 100, 'tolva %');
  assert.equal(textoPorcentaje(ind.tolvaPorcentaje), '22.11');
  assert.equal(ind.tolvaAcotadaEnCero, false);
  assert.equal(ind.pesoTeoricoBinKg, 190);
  assert.deepEqual(textoSubtituloTolva(ind), { kilos: '42 kg/bin', bin: 'Bin teórico: 190 kg' });
  assert.equal(textoPorcentaje(ind.pctPrimera), '57.89');
  assert.equal(textoPorcentaje(ind.pctSegunda), '20.00');
  assert.equal(textoKilosDeApoyo(ind.kgPrimera), '2.2 t');
  assert.equal(textoKilosDeApoyo(ind.kgSegunda), '760 kg');
});

test('anaheim 125, caribe 160, poblano 150, fresno 170 y serrano 185', () => {
  const anaheim = indicadoresPicosos(caso({
    kgPrimera: 400,
    kgSegunda: 200,
    kgConsumido: 8 * 125,
    binsConsumidos: 8,
    presentaciones: [
      { cajas: 50, cajasPorParrilla: 25 },
      { cajas: 20, cajasPorParrilla: 20 },
    ],
    pesoTeoricoBinKg: 125,
  }));
  cerca(anaheim.pctPrimera, 40, 'anaheim % 1ra');
  cerca(anaheim.pctSegunda, 20, 'anaheim % 2da');
  cerca(anaheim.binsPorParrilla, 8 / 3, 'anaheim bins/parrilla');
  cerca(anaheim.kgEfectivosPorBin, 75, 'anaheim kg/bin');
  cerca(anaheim.tolvaPorBin, 50, 'anaheim tolva');
  cerca(anaheim.tolvaPorcentaje, 40, 'anaheim tolva %');
  assert.equal(textoPorcentaje(anaheim.tolvaPorcentaje), '40.00');
  assert.deepEqual(textoSubtituloTolva(anaheim), { kilos: '50 kg/bin', bin: 'Bin teórico: 125 kg' });

  const caribe = indicadoresPicosos(caso({
    kgPrimera: 240,
    kgSegunda: 80,
    kgConsumido: 4 * 160,
    binsConsumidos: 4,
    presentaciones: [
      { cajas: 48, cajasPorParrilla: 24 },
      { cajas: 16, cajasPorParrilla: 16 },
    ],
    pesoTeoricoBinKg: 160,
  }));
  cerca(caribe.pctPrimera, 37.5, 'caribe % 1ra');
  cerca(caribe.pctSegunda, 12.5, 'caribe % 2da');
  cerca(caribe.binsPorParrilla, 4 / 3, 'caribe bins/parrilla');
  cerca(caribe.kgEfectivosPorBin, 80, 'caribe kg/bin');
  cerca(caribe.tolvaPorBin, 80, 'caribe tolva');
  assert.equal(textoPesoTeoricoBin(160), 'Bin teórico: 160 kg');

  const poblano = indicadoresPicosos(caso({
    kgPrimera: 360,
    kgSegunda: 180,
    kgConsumido: 6 * 150,
    binsConsumidos: 6,
    presentaciones: [
      { cajas: 45, cajasPorParrilla: 45 },
      { cajas: 30, cajasPorParrilla: 15 },
    ],
    hectareas: 3,
    pesoTeoricoBinKg: 150,
  }));
  cerca(poblano.pctPrimera, 40, 'poblano % 1ra');
  cerca(poblano.pctSegunda, 20, 'poblano % 2da');
  cerca(poblano.binsPorParrilla, 2, 'poblano bins/parrilla');
  cerca(poblano.kgEfectivosPorBin, 90, 'poblano kg/bin');
  cerca(poblano.tolvaPorBin, 60, 'poblano tolva');
  assert.equal(poblano.hectareasReservadas, false);
  cerca(poblano.tonPorHa, 0.54 / 3, 'poblano t/ha');
  assert.equal(textoNotaHectareas(poblano), '0.54 t · 3 ha');
  assert.equal(textoPesoTeoricoBin(150), 'Bin teórico: 150 kg');

  const fresno = indicadoresPicosos(caso({
    kgPrimera: 400,
    kgSegunda: 100,
    kgConsumido: 5 * 170,
    binsConsumidos: 5,
    presentaciones: [
      { cajas: 100, cajasPorParrilla: 50 },
      { cajas: 25, cajasPorParrilla: 25 },
    ],
    pesoTeoricoBinKg: 170,
  }));
  cerca(fresno.pctPrimera, (400 / 850) * 100, 'fresno % 1ra');
  cerca(fresno.pctSegunda, (100 / 850) * 100, 'fresno % 2da');
  cerca(fresno.binsPorParrilla, 5 / 3, 'fresno bins/parrilla');
  cerca(fresno.kgEfectivosPorBin, 100, 'fresno kg/bin');
  cerca(fresno.tolvaPorBin, 70, 'fresno tolva');
  assert.equal(textoPesoTeoricoBin(170), 'Bin teórico: 170 kg');

  const serrano = indicadoresPicosos(caso({
    kgPrimera: 180,
    kgSegunda: 70,
    kgConsumido: 2 * 185,
    binsConsumidos: 2,
    presentaciones: [
      { cajas: 20, cajasPorParrilla: 20 },
      { cajas: 10, cajasPorParrilla: 10 },
    ],
    pesoTeoricoBinKg: 185,
  }));
  cerca(serrano.pctPrimera, (180 / 370) * 100, 'serrano % 1ra');
  cerca(serrano.pctSegunda, (70 / 370) * 100, 'serrano % 2da');
  cerca(serrano.binsPorParrilla, 1, 'serrano bins/parrilla');
  cerca(serrano.kgEfectivosPorBin, 125, 'serrano kg/bin');
  cerca(serrano.tolvaPorBin, 60, 'serrano tolva');
  assert.equal(textoPesoTeoricoBin(185), 'Bin teórico: 185 kg');
});

test('el porcentaje usa el consumo del empaque, no un inventario más grande', () => {
  const ind = indicadoresPicosos(caso({
    kgPrimera: 40,
    kgSegunda: 5,
    kgConsumido: 100,
    binsConsumidos: 2,
    presentaciones: [{ cajas: 4, cajasPorParrilla: 4 }],
    pesoTeoricoBinKg: 190,
  }));
  cerca(ind.pctPrimera, 40, '% sobre 100 kg consumidos');
  cerca(ind.pctSegunda, 5, '% 2da');
  assert.ok(Math.abs((ind.pctPrimera ?? 0) - (40 / 800) * 100) > 1, 'no usa un recibido de 800 kg');
});

test('parrillas de segunda entran al rendimiento y un cpp vacío no', () => {
  const soloSegunda = indicadoresPicosos(caso({
    kgPrimera: 0,
    kgSegunda: 100,
    kgConsumido: 400,
    binsConsumidos: 4,
    presentaciones: [
      { cajas: 0, cajasPorParrilla: 40 },
      { cajas: 20, cajasPorParrilla: 10 },
    ],
    pesoTeoricoBinKg: 190,
  }));
  cerca(soloSegunda.parrillas, 2, 'solo 2da');
  cerca(soloSegunda.binsPorParrilla, 2, '4 bins / 2 parrillas');

  const varias = indicadoresPicosos(caso({
    kgPrimera: 100,
    kgSegunda: 50,
    kgConsumido: 300,
    binsConsumidos: 5,
    presentaciones: [
      { cajas: 40, cajasPorParrilla: 40 },
      { cajas: 20, cajasPorParrilla: 40 },
      { cajas: 10, cajasPorParrilla: 10 },
      { cajas: 8, cajasPorParrilla: 0 },
      { cajas: 8, cajasPorParrilla: null },
    ],
    pesoTeoricoBinKg: 160,
  }));
  cerca(varias.parrillas, 1 + 0.5 + 1, 'suma 1ra y 2da, ignora cpp vacío');
  cerca(varias.binsPorParrilla, 5 / 2.5, 'bins/parrilla');
});

test('sin empaque, sin bins y sin peso teórico', () => {
  const vacio = indicadoresPicosos(caso({ pesoTeoricoBinKg: 190 }));
  assert.equal(vacio.pctPrimera, null);
  assert.equal(vacio.pctSegunda, null);
  assert.equal(vacio.binsPorParrilla, null);
  assert.equal(vacio.kgEfectivosPorBin, null);
  assert.equal(vacio.tolvaPorBin, null);
  assert.equal(vacio.tolvaPorcentaje, null);
  assert.equal(vacio.hectareasReservadas, true);
  assert.equal(vacio.pesoTeoricoBinKg, 190);
  assert.deepEqual(textoSubtituloTolva(vacio), { kilos: null, bin: 'Bin teórico: 190 kg' });
  assert.equal(textoPorcentaje(null), '—');

  const sinBins = indicadoresPicosos(caso({
    kgPrimera: 80,
    kgSegunda: 20,
    kgConsumido: 200,
    binsConsumidos: 0,
    presentaciones: [{ cajas: 8, cajasPorParrilla: 8 }],
    pesoTeoricoBinKg: 170,
  }));
  cerca(sinBins.pctPrimera, 40, 'el % sigue si hubo consumo');
  assert.equal(sinBins.binsPorParrilla, null);
  assert.equal(sinBins.kgEfectivosPorBin, null);
  assert.equal(sinBins.tolvaPorBin, null);
  assert.equal(sinBins.tolvaPorcentaje, null);
  assert.deepEqual(textoSubtituloTolva(sinBins), { kilos: null, bin: 'Bin teórico: 170 kg' });

  const shishito = indicadoresPicosos(caso({
    kgPrimera: 180,
    kgSegunda: 60,
    kgConsumido: 400,
    binsConsumidos: 3,
    presentaciones: [
      { cajas: 18, cajasPorParrilla: 18 },
      { cajas: 12, cajasPorParrilla: 12 },
    ],
    pesoTeoricoBinKg: null,
  }));
  cerca(shishito.pctPrimera, 45, 'shishito % 1ra');
  cerca(shishito.pctSegunda, 15, 'shishito % 2da');
  cerca(shishito.kgEfectivosPorBin, 80, 'shishito kg/bin');
  cerca(shishito.binsPorParrilla, 1.5, 'shishito bins/parrilla');
  assert.equal(shishito.pesoTeoricoBinKg, null);
  assert.equal(shishito.tolvaPorBin, null);
  assert.equal(shishito.tolvaPorcentaje, null);
  assert.equal(textoPorcentaje(shishito.tolvaPorcentaje), '—');
  assert.deepEqual(textoSubtituloTolva(shishito), { kilos: null, bin: 'Sin peso teórico de bin' });
  assert.deepEqual(productoTolvaPorBin(null, 80), { kgPorBin: null, acotadoEnCero: false });
  assert.deepEqual(productoTolvaPorBin(170, null), { kgPorBin: null, acotadoEnCero: false });
});

test('hectáreas nulas, en cero o definidas sin toneladas', () => {
  const nulas = indicadoresPicosos(caso({
    kgPrimera: 1000,
    kgSegunda: 0,
    kgConsumido: 2000,
    binsConsumidos: 10,
    presentaciones: [{ cajas: 10, cajasPorParrilla: 10 }],
    hectareas: null,
    pesoTeoricoBinKg: 190,
  }));
  assert.equal(nulas.hectareasReservadas, true);
  assert.equal(nulas.tonPorHa, null);

  const cero = indicadoresPicosos(caso({ ...nulasInput(nulas), hectareas: 0 }));
  assert.equal(cero.hectareasReservadas, true);

  const negativa = indicadoresPicosos(caso({ ...nulasInput(nulas), hectareas: -2 }));
  assert.equal(negativa.hectareasReservadas, true);

  const sinTon = indicadoresPicosos(caso({
    hectareas: 4,
    pesoTeoricoBinKg: 190,
  }));
  assert.equal(sinTon.hectareasReservadas, false);
  assert.equal(sinTon.tonPorHa, null);
  assert.equal(textoNotaHectareas(sinTon), 'Sin toneladas empacadas');
  assert.equal(sinTon.hectareas, 4);
});

test('si el efectivo supera el peso teórico, la tolva queda en 0', () => {
  const ind = indicadoresPicosos(caso({
    kgPrimera: 200,
    kgSegunda: 100,
    kgConsumido: 250,
    binsConsumidos: 2,
    presentaciones: [{ cajas: 10, cajasPorParrilla: 10 }],
    pesoTeoricoBinKg: 125,
  }));
  cerca(ind.kgEfectivosPorBin, 150, 'kg/bin por encima del bin');
  assert.equal(ind.tolvaPorBin, 0);
  assert.equal(ind.tolvaPorcentaje, 0);
  assert.equal(textoPorcentaje(ind.tolvaPorcentaje), '0.00');
  assert.equal(ind.tolvaAcotadaEnCero, true);
  assert.deepEqual(textoSubtituloTolva(ind), { kilos: '0 kg/bin', bin: 'Bin teórico: 125 kg' });

  const exacto = indicadoresPicosos(caso({
    kgPrimera: 100,
    kgSegunda: 90,
    kgConsumido: 200,
    binsConsumidos: 1,
    presentaciones: [{ cajas: 10, cajasPorParrilla: 10 }],
    pesoTeoricoBinKg: 190,
  }));
  assert.equal(exacto.tolvaPorBin, 0);
  assert.equal(exacto.tolvaPorcentaje, 0);
  assert.equal(textoPorcentaje(exacto.tolvaPorcentaje), '0.00');
  assert.equal(exacto.tolvaAcotadaEnCero, false);
  assert.deepEqual(textoSubtituloTolva(exacto), { kilos: '0 kg/bin', bin: 'Bin teórico: 190 kg' });
});

test('el reporte lee el peso de la forma bins y no cuenta otras formas', () => {
  assert.equal(
    pesoTeoricoBinKg(
      [
        { codigo: 'cajas_campo', peso_kg: 15 },
        { codigo: 'BINS', peso_kg: 190 },
      ],
      15
    ),
    190
  );
  assert.equal(pesoTeoricoBinKg([{ codigo: 'bins', peso_kg: null }], 170), 170);
  assert.equal(pesoTeoricoBinKg([], 160), 160);
  assert.equal(pesoTeoricoBinKg([{ codigo: 'bins', peso_kg: null }], null), null);
  assert.equal(
    binsConsumidosDeFormas([
      { codigo: 'cajas_campo', consumidos: 99 },
      { codigo: 'bins', consumidos: 10 },
    ]),
    10
  );

  const jalapeno = indicadoresDesdeReporte({
    kg_primera: 800,
    kg_segunda: 300,
    kg_consumido: 1900,
    hectareas: null,
    peso_contenedor_kg: 15,
    formas: [
      { codigo: 'bins', peso_kg: 190 },
      { codigo: 'cajas_campo', peso_kg: 15 },
    ],
    por_forma: [
      { codigo: 'bins', consumidos: 10 },
      { codigo: 'cajas_campo', consumidos: 99 },
    ],
    por_presentacion_primera: [{ cajas: 80, cajas_por_parrilla: 40 }],
    por_presentacion_segunda: [{ cajas: 30, cajas_por_parrilla: 30 }],
  });
  assert.equal(jalapeno.pesoTeoricoBinKg, 190);
  assert.equal(jalapeno.binsConsumidos, 10);
  cerca(jalapeno.parrillas, 3, '2 + 1 parrillas');
  cerca(jalapeno.binsPorParrilla, 10 / 3, 'no usa las cajas de campo');
  cerca(jalapeno.kgEfectivosPorBin, 110, 'kg/bin');
  cerca(jalapeno.tolvaPorBin, 80, 'tolva');
  cerca(jalapeno.tolvaPorcentaje, (80 / 190) * 100, 'tolva %');
  cerca(jalapeno.pctPrimera, (800 / 1900) * 100, '% 1ra del reporte');
  assert.deepEqual(textoSubtituloTolva(jalapeno), { kilos: '80 kg/bin', bin: 'Bin teórico: 190 kg' });
});

function nulasInput(ind: { kgPrimera: number; kgSegunda: number; kgConsumido: number; binsConsumidos: number; pesoTeoricoBinKg: number | null }): PicososKpiInput {
  return {
    kgPrimera: ind.kgPrimera,
    kgSegunda: ind.kgSegunda,
    kgConsumido: ind.kgConsumido,
    binsConsumidos: ind.binsConsumidos,
    presentaciones: [{ cajas: 10, cajasPorParrilla: 10 }],
    pesoTeoricoBinKg: ind.pesoTeoricoBinKg,
  };
}
