/**
 * Lee empaques (JSON del API) y aplica la misma distribución que el reporte.
 * Lo llama scripts/test_melon_tallas_filtro.py. No escribe en la base.
 */
import { readFileSync } from 'node:fs';
import { PESO_CAJA_MELON_KG, variedadDesdeLoteMelon } from '../frontend/src/lib/constants.ts';
import {
  agregarDistribucionTallas,
  esProcesoCampoMelon,
  filtrarProcesosAcumulado,
  lotesDeEmpaqueMelon,
  sumaKgTallas,
  type EmpaqueDistribucion,
  type FiltroAcumuladoMelon,
} from '../frontend/src/lib/melonDistribucionTallas.ts';

type Emp = EmpaqueDistribucion & { id: number; lote_desverdizado?: string | null };

function pesoKg(presentacion: string): number {
  const tabla = PESO_CAJA_MELON_KG as Record<string, number>;
  return tabla[presentacion] ?? tabla.caja_normal_b;
}

function distribuir(empaques: Emp[], filtro: FiltroAcumuladoMelon, vista: 'simple' | 'tipos_caja') {
  const campo = empaques.filter(esProcesoCampoMelon);
  const procesos = campo.map((e) => ({
    id: e.id,
    lotes: lotesDeEmpaqueMelon(e),
  }));
  const sel = filtrarProcesosAcumulado(
    procesos,
    (p) => p.lotes,
    filtro,
    variedadDesdeLoteMelon
  );
  const ids = new Set(sel.map((p) => p.id));
  const rows = agregarDistribucionTallas(
    campo.filter((e) => ids.has(e.id)),
    (pres) => pesoKg(pres),
    vista
  );
  return {
    ids: [...ids].sort((a, b) => a - b),
    n: ids.size,
    suma: sumaKgTallas(rows),
    rows: rows.map((r) => ({
      label: r.label,
      talla: r.talla,
      presentacion: r.presentacion,
      cajas: r.cajas,
      kg: r.kg,
      llano: r.llano,
      wallys: r.wallys,
    })),
  };
}

const path = process.argv[2];
if (!path) {
  console.error('falta ruta json');
  process.exit(2);
}
const empaques = JSON.parse(readFileSync(path, 'utf8')) as Emp[];
const diputadoId = Number(process.argv[3]);
const out = {
  incluidos: empaques.filter(esProcesoCampoMelon).map((e) => e.id),
  excluidos: empaques.filter((e) => !esProcesoCampoMelon(e)).map((e) => e.id),
  todo: distribuir(empaques, { tipo: 'todos' }, 'simple'),
  todoCaja: distribuir(empaques, { tipo: 'todos' }, 'tipos_caja'),
  diputado: distribuir(empaques, { tipo: 'variedad', variedad: 'Diputado' }, 'simple'),
  diputadoCaja: distribuir(
    empaques,
    { tipo: 'variedad', variedad: 'Diputado' },
    'tipos_caja'
  ),
  krypto: distribuir(empaques, { tipo: 'variedad', variedad: 'Krypto' }, 'simple'),
  corrida: distribuir(
    empaques,
    { tipo: 'corrida', corridaIds: [String(diputadoId)] },
    'simple'
  ),
};
console.log(JSON.stringify(out));
