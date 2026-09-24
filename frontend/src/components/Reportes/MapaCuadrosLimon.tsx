import { useMemo, useState, type CSSProperties } from 'react';
import type { LoteRendimientoApi } from '../../lib/api';
import {
  MIX_VARIEDAD_POR_SECCION,
  VARIEDAD_LIMON_COLOR,
  VARIEDAD_LIMON_LABEL,
  seccionDesdeLote,
  type MixVariedadPct,
  type VariedadLimonCampo,
} from '../../lib/constants';

type Lote = LoteRendimientoApi;

/** Dimensiones exactas de la imagen guía (proporciones reales del rancho) */
const VB_W = 1474;
const VB_H = 1126;

/**
 * Polígonos calibrados a mano sobre la guía (editor-cuadros.html).
 * Derecha = S1 (C1 abajo → C5 arriba). Izquierda = S2 (C1 abajo → C3 arriba).
 * Coordenadas en píxeles de la guía 1474×1126.
 */
const CUADROS_GEO: Array<{
  seccion: string;
  points: string;
  cx: number;
  cy: number;
}> = [
  // ——— Sección 2 (izquierda) ———
  {
    seccion: 'S2C3',
    points: '335,511 745,492 714,653 302,666',
    cx: 524,
    cy: 581,
  },
  {
    seccion: 'S2C2',
    points: '293,687 704,664 676,825 260,852',
    cx: 483,
    cy: 757,
  },
  {
    seccion: 'S2C1',
    points: '249,866 670,841 637,1013 214,1030',
    cx: 443,
    cy: 938,
  },
  // ——— Sección 1 (derecha) ———
  {
    seccion: 'S1C5',
    points: '835,121 1254,100 1221,255 800,276',
    cx: 1028,
    cy: 188,
  },
  {
    seccion: 'S1C4',
    points: '793,295 1216,282 1181,446 762,471',
    cx: 988,
    cy: 374,
  },
  {
    seccion: 'S1C3',
    points: '766,490 1174,469 1141,622 733,642',
    cx: 954,
    cy: 556,
  },
  {
    seccion: 'S1C2',
    points: '729,664 1133,642 1095,802 691,823',
    cx: 912,
    cy: 733,
  },
  {
    seccion: 'S1C1',
    points: '687,839 1095,823 1063,988 649,1019',
    cx: 874,
    cy: 917,
  },
];

function fmtKg(n: number) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtNum(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function lotePorSeccion(lotes: Lote[], seccion: string): Lote | undefined {
  return lotes.find((l) => seccionDesdeLote(l.lote) === seccion);
}

function colorPrincipal(mix: MixVariedadPct[]): string {
  if (!mix.length) return '#64748b';
  const top = [...mix].sort((a, b) => b.pct - a.pct)[0];
  return VARIEDAD_LIMON_COLOR[top.variedad];
}

/** Color de acento del borde del botón = variedad dominante */
function accentBorder(mix: MixVariedadPct[]): string {
  return colorPrincipal(mix);
}

interface MapaCuadrosLimonProps {
  lotes: Lote[];
}

export default function MapaCuadrosLimon({ lotes }: MapaCuadrosLimonProps) {
  const [active, setActive] = useState<string | null>(null);

  const variedadesLeyenda = useMemo(() => {
    const set = new Set<VariedadLimonCampo>();
    for (const mix of Object.values(MIX_VARIEDAD_POR_SECCION)) {
      for (const m of mix) set.add(m.variedad);
    }
    return Array.from(set);
  }, []);

  const geo = active ? CUADROS_GEO.find((c) => c.seccion === active) : null;
  const lote = active ? lotePorSeccion(lotes, active) : undefined;
  const mix = active ? MIX_VARIEDAD_POR_SECCION[active] || [] : [];
  const accent = mix.length ? colorPrincipal(mix) : '#38bdf8';

  // Punto de anclaje de la línea en el borde derecho del SVG (hacia el panel)
  const lineEnd = { x: VB_W - 4, y: geo ? geo.cy : VB_H / 2 };

  return (
    <div style={{ marginTop: 20, marginBottom: 12 }}>
      <h4 style={{ margin: '0 0 4px', color: '#14532d' }}>Mapa de cuadros</h4>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 10 }}>
        Geometría según plano del rancho. <strong style={{ color: '#166534' }}>Sección 1</strong> a
        la derecha (C1↓→C5↑) · <strong style={{ color: '#6d28d9' }}>Sección 2</strong> a la
        izquierda (C1↓→C3↑).
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          border: '1px solid #cbd5e1',
          borderRadius: 14,
          overflow: 'hidden',
          background: '#f1f5f9',
          boxShadow: '0 6px 24px rgba(15,23,42,0.1)',
          minHeight: 420,
        }}
      >
        {/* Mapa a ancho completo del espacio */}
        <div style={{ flex: '1 1 0', minWidth: 0, position: 'relative', background: '#e2e8f0' }}>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{ display: 'block', minHeight: 480 }}
            role="img"
            aria-label="Mapa interactivo de cuadros de limón"
            onMouseLeave={() => setActive(null)}
          >
            <image
              href="/maps/cuadros-guia-fondo.jpg"
              x={0}
              y={0}
              width={VB_W}
              height={VB_H}
              preserveAspectRatio="xMidYMid meet"
            />
            {/* Velo suave: deja ver geometría, baja ruido de etiquetas viejas */}
            <rect x={0} y={0} width={VB_W} height={VB_H} fill="rgba(248,250,252,0.22)" />

            <defs>
              {CUADROS_GEO.map((c) => {
                const m = MIX_VARIEDAD_POR_SECCION[c.seccion] || [];
                if (m.length < 2) return null;
                const a = m[0];
                const b = m[1];
                const gap = Math.max(3, Math.round((b.pct / 100) * 18));
                return (
                  <pattern
                    key={`pat-${c.seccion}`}
                    id={`pat-${c.seccion}`}
                    patternUnits="userSpaceOnUse"
                    width={18}
                    height={18}
                    patternTransform="rotate(-30)"
                  >
                    <rect width="18" height="18" fill={VARIEDAD_LIMON_COLOR[a.variedad]} />
                    <rect width={gap} height="18" fill={VARIEDAD_LIMON_COLOR[b.variedad]} />
                  </pattern>
                );
              })}
              <filter id="btnGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.4" />
              </filter>
            </defs>

            {/* Títulos de sección con colores de la app */}
            <rect x={200} y={12} width={200} height={44} rx={12} fill="#6d28d9" opacity={0.92} />
            <text
              x={300}
              y={42}
              textAnchor="middle"
              style={{ fontSize: 22, fontWeight: 800, fill: '#fff' }}
            >
              Sección 2
            </text>
            <rect x={920} y={12} width={200} height={44} rx={12} fill="#166534" opacity={0.92} />
            <text
              x={1020}
              y={42}
              textAnchor="middle"
              style={{ fontSize: 22, fontWeight: 800, fill: '#fff' }}
            >
              Sección 1
            </text>

            {/* Línea guía al panel */}
            {geo && (
              <g pointerEvents="none">
                <line
                  x1={geo.cx}
                  y1={geo.cy}
                  x2={lineEnd.x}
                  y2={lineEnd.y}
                  stroke={accent}
                  strokeWidth={4}
                  strokeDasharray="12 7"
                  opacity={0.95}
                />
                <circle cx={geo.cx} cy={geo.cy} r={9} fill={accent} stroke="#fff" strokeWidth={3} />
                <circle cx={lineEnd.x} cy={lineEnd.y} r={6} fill={accent} stroke="#fff" strokeWidth={2} />
              </g>
            )}

            {CUADROS_GEO.map((c) => {
              const m = MIX_VARIEDAD_POR_SECCION[c.seccion] || [];
              const fill = m.length >= 2 ? `url(#pat-${c.seccion})` : colorPrincipal(m);
              const border = accentBorder(m);
              const isOn = active === c.seccion;
              return (
                <g
                  key={c.seccion}
                  onMouseEnter={() => setActive(c.seccion)}
                  onFocus={() => setActive(c.seccion)}
                  onClick={() => setActive(c.seccion)}
                  style={{ cursor: 'pointer' }}
                  filter={isOn ? 'url(#btnGlow)' : undefined}
                >
                  {/* Halo blanco tipo botón */}
                  <polygon
                    points={c.points}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={isOn ? 16 : 10}
                    opacity={0.95}
                  />
                  <polygon
                    points={c.points}
                    fill={fill}
                    fillOpacity={isOn ? 0.82 : 0.68}
                    stroke={isOn ? border : '#0f172a'}
                    strokeWidth={isOn ? 6 : 3.5}
                  />
                  {/* Chip etiqueta acorde a color de variedad dominante */}
                  <rect
                    x={c.cx - 58}
                    y={c.cy - 22}
                    width={116}
                    height={44}
                    rx={12}
                    fill={isOn ? border : 'rgba(15,23,42,0.82)'}
                    stroke="#fff"
                    strokeWidth={2.5}
                  />
                  <text
                    x={c.cx}
                    y={c.cy + 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      fill: '#fff',
                      pointerEvents: 'none',
                      letterSpacing: 0.5,
                    }}
                  >
                    {c.seccion}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Panel lateral — colores de la app */}
        <aside
          style={{
            width: 300,
            flexShrink: 0,
            background: '#0f172a',
            color: '#f8fafc',
            padding: '18px 16px',
            borderLeft: `4px solid ${active ? accent : '#38bdf8'}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {!active ? (
            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
                Detalle del cuadro
              </div>
              Selecciona un cuadro en el mapa. El panel no tapa el lote: una línea de color lo
              conecta con esta ficha.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  background: accent,
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 16,
                  padding: '6px 12px',
                  borderRadius: 8,
                  marginBottom: 6,
                }}
              >
                {active}
              </div>
              {lote ? (
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>{lote.lote}</div>
              ) : (
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
                  Sin lote vinculado
                </div>
              )}

              <div style={sectionTitle}>Variedades</div>
              {mix.map((m) => (
                <div key={m.variedad} style={rowStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: VARIEDAD_LIMON_COLOR[m.variedad],
                      }}
                    />
                    <span style={{ color: '#e2e8f0' }}>{VARIEDAD_LIMON_LABEL[m.variedad]}</span>
                  </span>
                  <strong style={{ color: VARIEDAD_LIMON_COLOR[m.variedad] }}>{m.pct}%</strong>
                </div>
              ))}

              <div style={{ ...sectionTitle, marginTop: 14 }}>Producción</div>
              {lote ? (
                <>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>Bins campo</span>
                    <strong>{lote.bins_campo}</strong>
                  </div>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>Parrillas 1ra</span>
                    <strong>{fmtNum(lote.parrillas_primera, 2)}</strong>
                  </div>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>Bins jugo</span>
                    <strong>{lote.bins_jugo}</strong>
                  </div>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>% kg 1ra</span>
                    <strong style={{ color: '#86efac' }}>{fmtNum(lote.pct_primera)}%</strong>
                  </div>
                  <div style={rowStyle}>
                    <span style={{ color: '#94a3b8' }}>% kg 2da</span>
                    <strong style={{ color: '#fde68a' }}>{fmtNum(lote.pct_segunda)}%</strong>
                  </div>
                  <div style={{ ...rowStyle, marginTop: 8, fontSize: 11, color: '#64748b' }}>
                    <span>Kg 1ra / 2da / tot</span>
                    <span>
                      {fmtKg(lote.kg_primera)} / {fmtKg(lote.kg_segunda)} / {fmtKg(lote.kg_salida)}
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ color: '#64748b', fontSize: 12 }}>Sin producción en este cuadro.</div>
              )}
            </>
          )}
        </aside>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginTop: 10,
          fontSize: 12,
        }}
      >
        {variedadesLeyenda.map((v) => (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: VARIEDAD_LIMON_COLOR[v],
              }}
            />
            <span style={{ color: '#334155', fontWeight: 600 }}>{VARIEDAD_LIMON_LABEL[v]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 5,
  fontSize: 13,
};

const sectionTitle: CSSProperties = {
  color: '#7dd3fc',
  fontWeight: 700,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.45,
  marginBottom: 6,
};
