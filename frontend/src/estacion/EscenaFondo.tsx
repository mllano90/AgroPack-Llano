import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { geometriaFondo, type Rect } from './geometriaFondo';
import {
  avanzarParticulas, cajaDeFase, crearLazo, crearParticulas, siguienteFase, unirEscena,
  type FaseId, type Particula, type Polvo,
} from './faseDelDia';
import { FOTOS } from './fotosFase';
import { useFase } from './faseReloj';
import { prefAmbiente } from './prefs';

function huecoVisible(fig: DOMRect): Rect {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const aire = rect('.zona-aire'), suelo = rect('.zona-suelo');
  const cab = rect('.cabecera'), nav = rect('nav');
  const vw = innerWidth, vh = innerHeight;
  let left = 2, right = vw - 2, top = (cab?.bottom ?? 0) + 4, bottom = (nav?.top ?? vh) - 4;
  if (aire && suelo && fig.bottom <= Math.min(aire.top, suelo.top) + 10) {
    bottom = Math.min(bottom, Math.min(aire.top, suelo.top) - 4);
  } else if (aire && suelo && aire.right < suelo.left - 16) {
    left = aire.right + 8;
    right = suelo.left - 8;
    top = Math.max(top, Math.min(aire.top, suelo.top));
    bottom = Math.min(bottom, Math.max(aire.bottom, suelo.bottom));
  } else if (aire && suelo) {
    top = Math.max(top, aire.bottom + 4);
    bottom = Math.min(bottom, suelo.top - 4);
  } else {
    left = fig.left; right = fig.right; top = fig.top; bottom = fig.bottom;
  }
  if (right - left < 48 || bottom - top < 48) {
    return { left: fig.left, top: fig.top, width: fig.width, height: fig.height };
  }
  return { left, top, width: right - left, height: bottom - top };
}

function alinear(fig: HTMLElement, lienzo: HTMLElement) {
  const r = fig.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const g = geometriaFondo(huecoVisible(r), { x: innerWidth / 2, y: innerHeight / 2 });
  const { box, ventana } = cajaDeFase(g.planta);
  const s = lienzo.style;
  s.left = box.left + 'px';
  s.top = box.top + 'px';
  s.width = box.width + 'px';
  s.height = box.height + 'px';
  const red = (o: Rect) => [o.left, o.top, o.width, o.height].map(v => Math.round(v)).join(',');
  lienzo.dataset.planta = red(ventana);
  lienzo.dataset.caja = red(box);
  const cubre = box.left <= 6 && box.left + box.width >= window.innerWidth - 6;
  const mask = cubre ? '' : 'linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)';
  lienzo.style.maskImage = mask;
  lienzo.style.setProperty('-webkit-mask-image', mask);
}

function useReducido() {
  const consulta = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [q, setQ] = useState(consulta);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setQ(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return q;
}

function useAnimar() {
  const [on, setOn] = useState(() => prefAmbiente.activo());
  useEffect(() => {
    const f = () => setOn(prefAmbiente.activo());
    window.addEventListener('estacion-ambiente', f);
    window.addEventListener('focus', f);
    return () => {
      window.removeEventListener('estacion-ambiente', f);
      window.removeEventListener('focus', f);
    };
  }, []);
  return on;
}

/** Dos capas, un índice. La que entra y la que sale comparten el mismo arreglo. */
function useCapas(fase: FaseId) {
  const [capas, setCapas] = useState<[FaseId, FaseId]>([fase, fase]);
  const [frente, setFrente] = useState<0 | 1>(0);
  const frenteRef = useRef<0 | 1>(0);
  const capasRef = useRef(capas);
  capasRef.current = capas;
  useEffect(() => {
    if (capasRef.current[frenteRef.current] === fase) return;
    const back: 0 | 1 = frenteRef.current === 0 ? 1 : 0;
    const next: [FaseId, FaseId] = [capasRef.current[0], capasRef.current[1]];
    next[back] = fase;
    capasRef.current = next;
    setCapas(next);
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        frenteRef.current = back;
        setFrente(back);
      });
    });
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
  }, [fase]);
  return { capas, frente };
}

const COLOR: Record<Polvo, string> = { oro: '#ffe3a4', brasa: '#ffb15a', luciernaga: '#dfffa8' };

function dibujar(canvas: HTMLCanvasElement, ps: Particula[], tipo: Polvo, t: number) {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLOR[tipo];
  for (const p of ps) {
    const pulso = 0.5 + 0.5 * Math.sin(t / 1000 * p.giro + p.fase);
    ctx.globalAlpha = tipo === 'luciernaga' ? p.a * pulso : p.a * (0.65 + 0.35 * pulso);
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function Capa({ id, activa, animar }: { id: FaseId; activa: boolean; animar: boolean }) {
  const unida = unirEscena(id, FOTOS);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { escena, foto } = unida;
  useEffect(() => {
    if (!activa || !animar) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const partes = crearParticulas(escena.polvo, escena.cantidad);
    let prev = performance.now();
    const lazo = crearLazo({
      raf: (cb) => requestAnimationFrame(cb),
      cancel: (n) => cancelAnimationFrame(n),
      oculto: () => document.hidden,
    });
    lazo.start((t) => {
      const dt = (t - prev) / 1000;
      prev = t;
      avanzarParticulas(partes, dt);
      dibujar(canvas, partes, escena.polvo, t);
    });
    const vis = () => { if (!document.hidden) lazo.reanudar(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      lazo.stop();
    };
  }, [activa, animar, id, escena.polvo, escena.cantidad]);
  const haz = escena.haz;
  const estilo = {
    '--hx': String(haz.x),
    '--hy': String(haz.y),
    '--rumbo': haz.rumbo + 'deg',
    '--hc': haz.color,
    animationDuration: haz.pulso + 's',
  } as CSSProperties;
  return (
    <div className={'fase-capa' + (activa ? ' activa' : '') + (id === 'noche' ? ' es-noche' : '')}>
      <picture>
        <source srcSet={foto.avif} type="image/avif" />
        <source srcSet={foto.webp} type="image/webp" />
        <img src={foto.jpg} alt="" draggable={false} />
      </picture>
      <div className="haz" style={estilo} />
      {animar && <canvas ref={canvasRef} aria-hidden="true" />}
    </div>
  );
}

/** Foto, relleno, haz y polvo de una sola fase, en la misma caja que la planta. */
export default function EscenaFondo() {
  const fase = useFase();
  const reducido = useReducido();
  const animar = useAnimar() && !reducido;
  const { capas, frente } = useCapas(fase);
  const lienzo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const img = new Image();
    img.src = FOTOS[siguienteFase(fase)].avif;
    return () => { img.src = ''; };
  }, [fase]);
  useEffect(() => {
    const fig = document.querySelector('.figura-planta');
    const caja = lienzo.current;
    if (!(fig instanceof HTMLElement) || !caja) return;
    const ajustar = () => alinear(fig, caja);
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(fig);
    const sc = fig.closest('.estacion-root');
    sc?.addEventListener('scroll', ajustar, { passive: true });
    window.addEventListener('resize', ajustar);
    window.addEventListener('orientationchange', ajustar);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', ajustar);
    vv?.addEventListener('scroll', ajustar);
    return () => {
      ro.disconnect();
      sc?.removeEventListener('scroll', ajustar);
      window.removeEventListener('resize', ajustar);
      window.removeEventListener('orientationchange', ajustar);
      vv?.removeEventListener('resize', ajustar);
      vv?.removeEventListener('scroll', ajustar);
    };
  }, []);
  return (
    <div className={'escena' + (animar ? '' : ' sin-anim')} data-fase={fase} aria-hidden="true">
      {capas.map((id, i) => (
        <img key={i} className={'escena-relleno' + (frente === i ? ' activa' : '')} src={FOTOS[id].relleno} alt="" />
      ))}
      <div ref={lienzo} className="escena-lienzo">
        {capas.map((id, i) => <Capa key={i + '-' + id} id={id} activa={frente === i} animar={animar} />)}
      </div>
    </div>
  );
}
