import type { FaseId } from './faseDelDia';
import nocheA from './assets/fases/noche.avif';
import nocheW from './assets/fases/noche.webp';
import nocheJ from './assets/fases/noche.jpg';
import nocheR from './assets/fases/noche-relleno.webp';
import amanecerA from './assets/fases/amanecer.avif';
import amanecerW from './assets/fases/amanecer.webp';
import amanecerJ from './assets/fases/amanecer.jpg';
import amanecerR from './assets/fases/amanecer-relleno.webp';
import mananaA from './assets/fases/manana.avif';
import mananaW from './assets/fases/manana.webp';
import mananaJ from './assets/fases/manana.jpg';
import mananaR from './assets/fases/manana-relleno.webp';
import mediodiaA from './assets/fases/mediodia.avif';
import mediodiaW from './assets/fases/mediodia.webp';
import mediodiaJ from './assets/fases/mediodia.jpg';
import mediodiaR from './assets/fases/mediodia-relleno.webp';
import atardecerA from './assets/fases/atardecer.avif';
import atardecerW from './assets/fases/atardecer.webp';
import atardecerJ from './assets/fases/atardecer.jpg';
import atardecerR from './assets/fases/atardecer-relleno.webp';

export type FotoFase = { avif: string; webp: string; jpg: string; relleno: string };

export const FOTOS: Record<FaseId, FotoFase> = {
  noche: { avif: nocheA, webp: nocheW, jpg: nocheJ, relleno: nocheR },
  amanecer: { avif: amanecerA, webp: amanecerW, jpg: amanecerJ, relleno: amanecerR },
  manana: { avif: mananaA, webp: mananaW, jpg: mananaJ, relleno: mananaR },
  mediodia: { avif: mediodiaA, webp: mediodiaW, jpg: mediodiaJ, relleno: mediodiaR },
  atardecer: { avif: atardecerA, webp: atardecerW, jpg: atardecerJ, relleno: atardecerR },
};
