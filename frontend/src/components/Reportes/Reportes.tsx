import { useEffect, useState, type CSSProperties } from 'react';
import { getApiBaseUrl } from '../../lib/api';
import { PESO_BIN_CAMPO_KG } from '../../lib/constants';

interface CorridaRendimiento {
  id: number;
  fecha: string;
  numero_empacador?: string | null;
  bins_campo: number;
  kg_entrada: number;
  kg_primera: number;
  kg_segunda: number;
  kg_salida: number;
  pct_primera: number;
  pct_segunda: number;
  pct_recuperacion: number;
  cajas_rpc: number;
  cajas_carton: number;
  bins_jugo: number;
  parrillas_rpc: number;
  parrillas_carton: number;
  parrillas_jugo: number;
  parrillas_total: number;
  bins_por_parrilla: number | null;
  lotes_resumen?: string | null;
}

interface LoteRendimiento {
  lote: string;
  bins_campo: number;
  kg_entrada: number;
  kg_primera: number;
  kg_segunda: number;
  kg_salida: number;
  pct_primera: number;
  pct_segunda: number;
  pct_recuperacion: number;
  cajas_rpc: number;
  cajas_carton: number;
  bins_jugo: number;
  parrillas_total: number;
  num_corridas: number;
  prorrateado: boolean;
}

interface ReportesProps {
  token: string;
}

const cardStyle: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 140,
};

function fmtKg(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export default function Reportes({ token }: ReportesProps) {
  const [corridas, setCorridas] = useState<CorridaRendimiento[]>([]);
  const [porLote, setPorLote] = useState<LoteRendimiento[]>([]);
  const [acumulado, setAcumulado] = useState<CorridaRendimiento | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vista, setVista] = useState<'lote' | 'corrida'>('lote');

  const load = () => {
    setLoading(true);
    setError('');
    const base = getApiBaseUrl().replace(/\/$/, '');
    fetch(`${base}/api/reports/rendimientos-limon`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text();
          throw new Error(t || r.statusText);
        }
        return r.json();
      })
      .then((data) => {
        setCorridas(data.corridas || []);
        setPorLote(data.por_lote || []);
        setAcumulado(data.acumulado || null);
      })
      .catch((e) => setError(e.message || 'Error al cargar reportes'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  if (loading) {
    return (
      <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
        <h2>📊 Reportes de rendimiento (Limón)</h2>
        <p style={{ color: '#64748b' }}>Cargando…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
        <h2>📊 Reportes de rendimiento (Limón)</h2>
        <p style={{ color: '#dc2626' }}>{error}</p>
        <button type="button" onClick={load} style={{ padding: '8px 16px' }}>
          Reintentar
        </button>
      </div>
    );
  }

  const a = acumulado;
  const tabBtn = (id: 'lote' | 'corrida'): CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: vista === id ? 700 : 400,
    background: vista === id ? '#15803d' : '#f1f5f9',
    color: vista === id ? 'white' : '#334155',
  });

  return (
    <div style={{ background: 'white', padding: 25, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>📊 Reportes de rendimiento (Limón)</h2>
        <button type="button" onClick={load} style={{ padding: '8px 14px' }}>
          Actualizar
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
        Bin campo = {PESO_BIN_CAMPO_KG} kg · RPC 12 = 12 kg · RPC 18 / cartón = 18 kg · Bin jugo = 900 kg ·
        Parrilla RPC = 45 cajas · Parrilla cartón = 63 cajas · 1 bin jugo = 1 parrilla
      </p>

      {/* Acumulado */}
      {a && (
        <div style={{ marginTop: 20 }}>
          <h3>Acumulado (todas las corridas)</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Bins de campo</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{a.bins_campo}</div>
              <div style={{ fontSize: 12 }}>{fmtKg(a.kg_entrada)} kg entrada</div>
            </div>
            <div style={{ ...cardStyle, background: '#dcfce7' }}>
              <div style={{ fontSize: 12, color: '#166534' }}>1ra calidad (kg)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKg(a.kg_primera)}</div>
              <div style={{ fontSize: 12 }}>{a.pct_primera}% del campo</div>
            </div>
            <div style={{ ...cardStyle, background: '#fef9c3' }}>
              <div style={{ fontSize: 12, color: '#854d0e' }}>2da calidad / jugo (kg)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKg(a.kg_segunda)}</div>
              <div style={{ fontSize: 12 }}>{a.pct_segunda}% del campo</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Kg totales producidos</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtKg(a.kg_salida)}</div>
              <div style={{ fontSize: 12 }}>{a.pct_recuperacion}% recuperación</div>
            </div>
            <div style={{ ...cardStyle, background: '#e0f2fe' }}>
              <div style={{ fontSize: 12, color: '#075985' }}>Parrillas totales</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{a.parrillas_total}</div>
              <div style={{ fontSize: 12 }}>
                RPC {a.parrillas_rpc} · Cartón {a.parrillas_carton} · Jugo {a.parrillas_jugo}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b' }}>Bins → Parrillas</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {a.bins_campo} bins → {a.parrillas_total} parrillas
              </div>
              <div style={{ fontSize: 12 }}>
                {a.bins_por_parrilla != null
                  ? `${a.bins_por_parrilla} bins de campo por parrilla`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 24, marginBottom: 12 }}>
        <button type="button" style={tabBtn('lote')} onClick={() => setVista('lote')}>
          Por lote
        </button>
        <button type="button" style={tabBtn('corrida')} onClick={() => setVista('corrida')}>
          Por corrida
        </button>
      </div>

      {vista === 'lote' && (
        <>
          <h3 style={{ marginTop: 8 }}>Rendimiento por lote</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
            Por cada lote de campo: kg de entrada, kg totales producidos, cuánto fue a 1ra (RPC/cartón) y
            a 2da (bins jugo). Si un empaque mezcló varios lotes, la producción se reparte en
            proporción a los bins de cada lote.
          </p>
          {porLote.length === 0 ? (
            <p style={{ color: '#64748b' }}>
              Aún no hay lotes con empaque registrado. Empaca limón con consumos de lote para ver
              rendimientos aquí.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  minWidth: 860,
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>Lote</th>
                    <th style={th}>Bins campo</th>
                    <th style={th}>kg entrada</th>
                    <th style={th}>kg total prod.</th>
                    <th style={th}>kg 1ra</th>
                    <th style={th}>% 1ra</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>% 2da</th>
                    <th style={th}>% recup.</th>
                    <th style={th}>Parrillas</th>
                    <th style={th}>Corridas</th>
                  </tr>
                </thead>
                <tbody>
                  {porLote.map((l) => (
                    <tr key={l.lote} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>
                        <strong>{l.lote}</strong>
                        {l.prorrateado && (
                          <div style={{ fontSize: 11, color: '#b45309' }}>
                            * prorrateado (mezcla)
                          </div>
                        )}
                      </td>
                      <td style={td}>{l.bins_campo}</td>
                      <td style={td}>{fmtKg(l.kg_entrada)}</td>
                      <td style={td}>
                        <strong>{fmtKg(l.kg_salida)}</strong>
                      </td>
                      <td style={{ ...td, background: '#f0fdf4' }}>{fmtKg(l.kg_primera)}</td>
                      <td style={td}>
                        <strong>{l.pct_primera}%</strong>
                      </td>
                      <td style={{ ...td, background: '#fefce8' }}>{fmtKg(l.kg_segunda)}</td>
                      <td style={td}>
                        <strong>{l.pct_segunda}%</strong>
                      </td>
                      <td style={td}>{l.pct_recuperacion}%</td>
                      <td style={td}>{l.parrillas_total}</td>
                      <td style={td}>{l.num_corridas}</td>
                    </tr>
                  ))}
                </tbody>
                {porLote.length > 1 && (
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                      <td style={td}>TOTAL</td>
                      <td style={td}>{porLote.reduce((s, l) => s + l.bins_campo, 0)}</td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_entrada, 0))}
                      </td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_salida, 0))}
                      </td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_primera, 0))}
                      </td>
                      <td style={td}>—</td>
                      <td style={td}>
                        {fmtKg(porLote.reduce((s, l) => s + l.kg_segunda, 0))}
                      </td>
                      <td style={td}>—</td>
                      <td style={td}>—</td>
                      <td style={td}>
                        {porLote.reduce((s, l) => s + l.parrillas_total, 0).toFixed(1)}
                      </td>
                      <td style={td}>—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}

      {vista === 'corrida' && (
        <>
          <h3 style={{ marginTop: 8 }}>Por corrida de empaque</h3>
          {corridas.length === 0 ? (
            <p style={{ color: '#64748b' }}>
              Aún no hay corridas de limón con detalle. Registra un empaque de limón (con consumos y
              producción) para ver rendimientos aquí.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  minWidth: 900,
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>#</th>
                    <th style={th}>Fecha</th>
                    <th style={th}>Lotes</th>
                    <th style={th}>Bins campo</th>
                    <th style={th}>kg total</th>
                    <th style={th}>kg 1ra</th>
                    <th style={th}>% 1ra</th>
                    <th style={th}>kg 2da</th>
                    <th style={th}>% 2da</th>
                    <th style={th}>% recup.</th>
                    <th style={th}>Parrillas</th>
                    <th style={th}>Bins → Parr.</th>
                  </tr>
                </thead>
                <tbody>
                  {corridas.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>{c.id}</td>
                      <td style={td}>{c.fecha}</td>
                      <td style={td}>{c.lotes_resumen || '—'}</td>
                      <td style={td}>
                        {c.bins_campo}
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtKg(c.kg_entrada)} kg</div>
                      </td>
                      <td style={td}>
                        <strong>{fmtKg(c.kg_salida)}</strong>
                      </td>
                      <td style={td}>{fmtKg(c.kg_primera)}</td>
                      <td style={td}>
                        <strong>{c.pct_primera}%</strong>
                      </td>
                      <td style={td}>{fmtKg(c.kg_segunda)}</td>
                      <td style={td}>
                        <strong>{c.pct_segunda}%</strong>
                      </td>
                      <td style={td}>{c.pct_recuperacion}%</td>
                      <td style={td}>
                        <strong>{c.parrillas_total}</strong>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          R{c.parrillas_rpc} / C{c.parrillas_carton} / J{c.parrillas_jugo}
                        </div>
                      </td>
                      <td style={td}>
                        {c.bins_campo} → {c.parrillas_total}
                        {c.bins_por_parrilla != null && (
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {c.bins_por_parrilla} bins/parr.
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const th: CSSProperties = {
  padding: '10px 8px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '10px 8px',
  verticalAlign: 'top',
};
