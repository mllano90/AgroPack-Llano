/**
 * Barras del enlace LoRa (pie de Inicio). Escalas lineales en dB:
 *  - VERDE "Fuerza de enlace" (RSSI): -120 dBm = vacía, -40 dBm o mejor = llena.
 *  - ROJA "Interferencia" (SNR, inverso): SNR >= +10 dB = vacía (señal limpia); SNR <= -20 dB = llena
 *    (ruido por encima de la señal; SF7 deja de decodificar cerca de -7.5 dB).
 */
const lim = (x: number) => Math.max(0, Math.min(100, x));
export const RSSI_VACIA = -120, RSSI_LLENA = -40, SNR_LIMPIA = 10, SNR_RUIDO = -20;
export const pctFuerza = (rssi: number) => lim(((rssi - RSSI_VACIA) / (RSSI_LLENA - RSSI_VACIA)) * 100);
export const pctInterferencia = (snr: number) => lim(((SNR_LIMPIA - snr) / (SNR_LIMPIA - SNR_RUIDO)) * 100);

function Barra({ clase, etiqueta, pct, texto, titulo }: { clase: string; etiqueta: string; pct: number; texto: string; titulo: string }) {
  return (
    <span className={'enlace ' + clase} title={titulo}>
      <span className="enlace-et">{etiqueta}</span>
      <span className="enlace-barra" role="meter" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
        aria-valuetext={texto}><i style={{ width: `${pct}%` }} /></span>
      <span className="enlace-num">{texto}</span>
    </span>
  );
}

export default function BarrasEnlace({ rssi, snr }: { rssi?: number | null; snr?: number | null }) {
  if (rssi == null && snr == null) return null;
  return (
    <span className="enlaces" aria-label="Calidad del enlace LoRa">
      {rssi != null && <Barra clase="fuerza" etiqueta="Fuerza de enlace" pct={pctFuerza(rssi)} texto={`RSSI ${rssi} dBm`}
        titulo="Verde: fuerza de la señal LoRa (RSSI). Llena = -40 dBm o mejor; vacía = -120 dBm." />}
      {snr != null && <Barra clase="interf" etiqueta="Interferencia" pct={pctInterferencia(snr)}
        texto={`SNR ${snr.toFixed(1)} dB`}
        titulo="Rojo: interferencia / ruido (a partir del SNR). Vacía = señal limpia (SNR ≥ 10 dB); llena = mucho ruido (SNR ≤ -20 dB)." />}
    </span>
  );
}
