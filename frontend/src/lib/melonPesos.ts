import { useCallback, useEffect, useState } from 'react';
import {
  FILAS_CAJA_MELON,
  PESO_BIN_CAMPO_MELON_KG,
  PESO_CAJA_MELON_KG,
  type TipoCajaMelon,
} from './constants';

const STORAGE_KEY = 'agropack_melon_pesos_v1';
const EVENT_NAME = 'agropack-melon-pesos-changed';

/** Clave estable para peso por presentación × talla (misma calidad LLANO/Wallys). */
export function clavePesoTalla(presentacion: string, talla: string): string {
  const t = String(talla || '')
    .replace(/^#/, '')
    .replace(/s$/i, '')
    .trim();
  return `${presentacion}|${t}`;
}

/** Lista de variantes editables: todas las cajas × tallas del catálogo. */
export function variantesPesoMelon(): Array<{
  presentacion: TipoCajaMelon;
  talla: string;
  key: string;
  label: string;
  cajaLabel: string;
}> {
  const out: Array<{
    presentacion: TipoCajaMelon;
    talla: string;
    key: string;
    label: string;
    cajaLabel: string;
  }> = [];
  for (const fila of FILAS_CAJA_MELON) {
    for (const t of fila.tallas) {
      const key = clavePesoTalla(fila.presentacion, t);
      out.push({
        presentacion: fila.presentacion,
        talla: t,
        key,
        label: `#${t}s`,
        cajaLabel: fila.label,
      });
    }
  }
  return out;
}

/** Pesos editables (admin). LLANO y Wallys comparten el mismo peso. */
export type MelonPesosConfig = {
  bin_campo_kg: number;
  /** Fallback por tipo de caja si no hay peso por talla. */
  caja_chica_a: number;
  caja_normal_b: number;
  caja_jumbo_c: number;
  /** Pesos por presentación|talla, ej. "caja_jumbo_c|6". */
  por_talla: Record<string, number>;
  updated_at?: string | null;
};

export function defaultMelonPesos(): MelonPesosConfig {
  const por_talla: Record<string, number> = {};
  for (const v of variantesPesoMelon()) {
    por_talla[v.key] =
      PESO_CAJA_MELON_KG[v.presentacion] ?? PESO_CAJA_MELON_KG.caja_normal_b;
  }
  return {
    bin_campo_kg: PESO_BIN_CAMPO_MELON_KG,
    caja_chica_a: PESO_CAJA_MELON_KG.caja_chica_a,
    caja_normal_b: PESO_CAJA_MELON_KG.caja_normal_b,
    caja_jumbo_c: PESO_CAJA_MELON_KG.caja_jumbo_c,
    por_talla,
    updated_at: null,
  };
}

function sanitize(raw: Partial<MelonPesosConfig> | null | undefined): MelonPesosConfig {
  const d = defaultMelonPesos();
  if (!raw || typeof raw !== 'object') return d;
  const num = (v: unknown, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fb;
  };
  const por: Record<string, number> = { ...d.por_talla };
  if (raw.por_talla && typeof raw.por_talla === 'object') {
    for (const [k, v] of Object.entries(raw.por_talla)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) por[k] = n;
    }
  }
  // Asegurar que existan todas las variantes del catálogo
  for (const v of variantesPesoMelon()) {
    if (!(v.key in por)) {
      const fb =
        v.presentacion === 'caja_chica_a'
          ? num(raw.caja_chica_a, d.caja_chica_a)
          : v.presentacion === 'caja_jumbo_c'
            ? num(raw.caja_jumbo_c, d.caja_jumbo_c)
            : num(raw.caja_normal_b, d.caja_normal_b);
      por[v.key] = fb;
    }
  }
  return {
    bin_campo_kg: num(raw.bin_campo_kg, d.bin_campo_kg),
    caja_chica_a: num(raw.caja_chica_a, d.caja_chica_a),
    caja_normal_b: num(raw.caja_normal_b, d.caja_normal_b),
    caja_jumbo_c: num(raw.caja_jumbo_c, d.caja_jumbo_c),
    por_talla: por,
    updated_at: raw.updated_at ? String(raw.updated_at) : null,
  };
}

export function loadMelonPesos(): MelonPesosConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMelonPesos();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultMelonPesos();
  }
}

export function saveMelonPesos(cfg: MelonPesosConfig): MelonPesosConfig {
  const next = sanitize({
    ...cfg,
    updated_at: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  return next;
}

export function resetMelonPesos(): MelonPesosConfig {
  localStorage.removeItem(STORAGE_KEY);
  const next = defaultMelonPesos();
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  return next;
}

function pesoPresentacionFallback(cfg: MelonPesosConfig, presentacion: string): number {
  if (presentacion === 'caja_chica_a') return cfg.caja_chica_a;
  if (presentacion === 'caja_normal_b') return cfg.caja_normal_b;
  if (presentacion === 'caja_jumbo_c') return cfg.caja_jumbo_c;
  return PESO_CAJA_MELON_KG[presentacion as TipoCajaMelon] || cfg.caja_normal_b;
}

/**
 * Peso kg/caja. Si hay talla y existe en por_talla, usa ese valor.
 * LLANO y Wallys pesan igual (no se distingue calidad).
 */
export function pesoCajaDesdeConfig(
  cfg: MelonPesosConfig,
  presentacion: string,
  talla?: string | null
): number {
  if (talla != null && String(talla).trim() !== '') {
    const key = clavePesoTalla(presentacion, String(talla));
    const n = cfg.por_talla?.[key];
    if (Number.isFinite(n) && (n as number) > 0) return n as number;
  }
  return pesoPresentacionFallback(cfg, presentacion);
}

/** Hook: pesos actuales + guardar (reacciona a cambios en otras pestañas/ventanas). */
export function useMelonPesos(): {
  pesos: MelonPesosConfig;
  setPesos: (p: MelonPesosConfig) => void;
  guardar: () => MelonPesosConfig;
  restaurarDefaults: () => MelonPesosConfig;
} {
  const [pesos, setPesos] = useState<MelonPesosConfig>(() => loadMelonPesos());

  useEffect(() => {
    const sync = () => setPesos(loadMelonPesos());
    const onCustom = () => sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener(EVENT_NAME, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const guardar = useCallback(() => {
    const next = saveMelonPesos(pesos);
    setPesos(next);
    return next;
  }, [pesos]);

  const restaurarDefaults = useCallback(() => {
    const next = resetMelonPesos();
    setPesos(next);
    return next;
  }, []);

  return { pesos, setPesos, guardar, restaurarDefaults };
}
