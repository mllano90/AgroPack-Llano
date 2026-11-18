/** Lienzo de fondo_continuo.jpg. La foto original (1280×720) está en FOTO; la planta, en PLANTA.
 *  La escala mete la planta entera en el hueco, sin recortarla ni estirarla, y la centra ahí.
 *  Las fotos de fase usan esta misma caja: así el tamaño en pantalla no cambia. */
const LIENZO = { w: 2800, h: 3560 }, FOTO = { x: 760, y: 1040 }, FOTO_TAM = { w: 1280, h: 720 };
export const PLANTA_CONTINUO = { x0: 232, x1: 942, y0: 99, y1: 719 };

export type Rect = { left: number; top: number; width: number; height: number };

export function geometriaFondo(hueco: Rect, ancla?: { x: number; y: number }) {
  const pw = PLANTA_CONTINUO.x1 - PLANTA_CONTINUO.x0, ph = PLANTA_CONTINUO.y1 - PLANTA_CONTINUO.y0;
  const s = Math.min(hueco.width / pw, hueco.height / ph);
  const plantW = pw * s, plantH = ph * s;
  const ax = ancla?.x ?? hueco.left + hueco.width / 2;
  const ay = ancla?.y ?? hueco.top + hueco.height / 2;
  const left = Math.min(Math.max(ax - plantW / 2, hueco.left), hueco.left + hueco.width - plantW);
  const top = Math.min(Math.max(ay - plantH / 2, hueco.top), hueco.top + hueco.height - plantH);
  const cx = FOTO.x + (PLANTA_CONTINUO.x0 + PLANTA_CONTINUO.x1) / 2;
  const cy = FOTO.y + (PLANTA_CONTINUO.y0 + PLANTA_CONTINUO.y1) / 2;
  const x = left + plantW / 2 - cx * s, y = top + plantH / 2 - cy * s;
  const planta = { left: x + (FOTO.x + PLANTA_CONTINUO.x0) * s, top: y + (FOTO.y + PLANTA_CONTINUO.y0) * s, width: plantW, height: plantH };
  const foto = { left: x + FOTO.x * s, top: y + FOTO.y * s, width: FOTO_TAM.w * s, height: FOTO_TAM.h * s };
  return { s, x, y, w: LIENZO.w * s, h: LIENZO.h * s, planta, foto };
}
