/** Preferencias de UI en localStorage (no van al servidor). */
const CLAVE_AMBIENTE = 'estacion_ambiente';

/** Capa animada de Inicio: default ON (solo se apaga si el valor es "0"). */
export const prefAmbiente = {
  activo: (): boolean => {
    try { return localStorage.getItem(CLAVE_AMBIENTE) !== '0'; } catch { return true; }
  },
  set: (v: boolean) => {
    try { localStorage.setItem(CLAVE_AMBIENTE, v ? '1' : '0'); } catch { /* privado / sin storage */ }
  },
};

/** Umbrales de la capa de ambiente (aire °C, piranómetro W/m²). */
export const UMBRAL_AMB = { calor: 38, frio: 15, sol: 700 } as const;
