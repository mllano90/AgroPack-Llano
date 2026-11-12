import { useEffect, useState, type CSSProperties } from 'react';
import { mensajeError, reporteCatalogo, type ReporteCatalogo } from '../../lib/catalogoApi';

interface Props {
  token: string;
  productoId: number;
  seccion: 'produccion' | 'inventarios' | 'embarques';
  reload: number;
}

const card: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '10px 12px',
  minWidth: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};

const chip: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(255,255,255,0.65)',
  borderRadius: 6,
  padding: '5px 8px',
};

const COLORES = ['#15803d', '#0284c7', '#ca8a04', '#7c3aed', '#ea580c', '#0f766e'];
const FONDOS = [
  { bg: '#dbeafe', label: '#1e40af', value: '#1e3a8a' },
  { bg: '#ffedd5', label: '#9a3412', value: '#7c2d12' },
  { bg: '#f3e8ff', label: '#6b21a8', value: '#581c87' },
  { bg: '#ccfbf1', label: '#115e59', value: '#134e4a' },
];

function fmtKg(n: number) {
  return (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}
function fmtTon(n: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 10) return n.toFixed(1);
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

export default function CatalogoReportes({ token, productoId, seccion, reload }: Props) {
  const [data, setData] = useState<ReporteCatalogo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    setError('');
    reporteCatalogo(token, productoId)
      .then((d) => {
        if (!cancel) setData(d);
      })
      .catch((err) => {
        if (!cancel) setError(mensajeError(err));
      });
    return () => {
      cancel = true;
    };
  }, [token, productoId, reload]);

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (!data) return <p style={{ color: '#64748b' }}>Cargando reporte…</p>;

  if (seccion === 'inventarios') return <Inventario data={data} />;
  if (seccion === 'embarques') return <Embarques data={data} />;
  return <Produccion data={data} />;
}

function Produccion({ data }: { data: ReporteCatalogo }) {
  const unidad =
    data.tipo_cosecha === 'bins' ? 'Bins' : data.tipo_cosecha === 'cajas_campo' ? 'Cajas campo' : data.tipo_cosecha_nombre;
  const partes = [
    ...data.por_presentacion_primera
      .filter((p) => p.kg > 0)
      .map((p, i) => ({ label: p.nombre, kg: p.kg, color: COLORES[i % COLORES.length] })),
    ...(data.kg_segunda > 0 ? [{ label: '2da', kg: data.kg_segunda, color: '#f9a8d4' }] : []),
  ];
  const totalBar = partes.reduce((s, p) => s + p.kg, 0);

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        {unidad} = {fmtNum(data.peso_contenedor_kg, 1)} kg
        {data.hectareas ? ` · ${fmtNum(data.hectareas, 2)} ha` : ' · sin hectáreas (ton/ha en blanco)'}
        {' · '}
        <strong>
          {unidad} / parrilla = {unidad.toLowerCase()} recibidos ÷ parrillas de 1ra
        </strong>
        . El % de 1ra y de 2da es sobre los kilos de campo.
      </p>
      <h3 style={{ marginBottom: 8 }}>Acumulado — indicadores principales</h3>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
        Resumen del total recibido y empacado de {data.nombre}.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 10,
        }}
      >
        <Kpi bg="#dcfce7" labelColor="#166534" valueColor="#14532d" titulo="1ra calidad" valor={fmtNum(data.pct_primera)} sufijo="%" chips={[
          ['Kg', fmtKg(data.kg_primera)],
          ['Kg/ha', fmtNum(data.kg_primera_por_ha)],
        ]} />
        <Kpi bg="#fef9c3" labelColor="#854d0e" valueColor="#713f12" titulo="2da calidad" valor={fmtNum(data.pct_segunda)} sufijo="%" chips={[
          ['Kg', fmtKg(data.kg_segunda)],
          ['Kg/ha', fmtNum(data.kg_segunda_por_ha)],
        ]} />
        <Kpi bg="#f0fdf4" labelColor="#166534" valueColor="#14532d" titulo="Ton / ha" valor={fmtTon(data.ton_por_ha)} chips={[
          ['1ra', `${fmtNum(data.pct_primera, 1)}%`],
          ['2da', `${fmtNum(data.pct_segunda, 1)}%`],
        ]} />
        <Kpi bg="#e0f2fe" labelColor="#075985" valueColor="#0c4a6e" titulo={`${unidad} / parrilla`} valor={data.contenedores_por_parrilla != null ? fmtNum(data.contenedores_por_parrilla, 2) : '—'} chips={[
          [unidad, String(data.contenedores)],
          ['Parr. 1ra', fmtNum(data.parrillas_primera, 2)],
        ]} />
        {data.por_presentacion_primera.map((p, i) => {
          const c = FONDOS[i % FONDOS.length];
          return (
            <Kpi
              key={p.tipo_caja_id}
              bg={c.bg}
              labelColor={c.label}
              valueColor={c.value}
              titulo={`% 1ra en ${p.nombre}`}
              valor={fmtNum(p.pct, 1)}
              sufijo="%"
              chips={[
                ['Kg', fmtKg(p.kg)],
                ['Cajas', String(p.cajas)],
              ]}
            />
          );
        })}
      </div>

      <h4 style={{ margin: '16px 0 8px' }}>
        Distribución por tipo de caja (1ra) y 2da calidad — acumulado total
      </h4>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
        Cada segmento es la participación en kilos empacados. El segmento rosado es 2da.
      </p>
      {totalBar <= 0 ? (
        <p style={{ color: '#64748b' }}>Aún no hay empaque para graficar.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            {partes.map((p) => (
              <div
                key={p.label}
                title={`${p.label}: ${fmtKg(p.kg)} kg`}
                style={{ width: `${(p.kg / totalBar) * 100}%`, background: p.color }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 13 }}>
            {partes.map((p) => (
              <span key={p.label}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: p.color, borderRadius: 2, marginRight: 6 }} />
                {p.label}: {fmtKg(p.kg)} kg ({fmtNum((p.kg / totalBar) * 100, 1)}%)
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  bg,
  labelColor,
  valueColor,
  titulo,
  valor,
  sufijo,
  chips,
}: {
  bg: string;
  labelColor: string;
  valueColor: string;
  titulo: string;
  valor: string;
  sufijo?: string;
  chips: Array<[string, string]>;
}) {
  return (
    <div style={{ ...card, background: bg }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: labelColor }}>
        {titulo}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: valueColor, lineHeight: 1.1 }}>
        {valor}
        {sufijo && <span style={{ fontSize: 15, marginLeft: 1 }}>{sufijo}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {chips.map(([k, v]) => (
          <div key={k} style={chip}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: valueColor }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Inventario({ data }: { data: ReporteCatalogo }) {
  const unidad = data.tipo_cosecha_nombre;
  return (
    <div style={{ marginTop: 12 }}>
      <h3>Campo — {unidad}</h3>
      {data.campo.length === 0 ? (
        <p style={{ color: '#64748b' }}>Sin recepciones.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 520, marginBottom: 16 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th style={{ padding: 8 }}>Lote</th>
              <th style={{ padding: 8 }}>Disponibles</th>
            </tr>
          </thead>
          <tbody>
            {data.campo.map((c) => (
              <tr key={c.lote}>
                <td style={{ padding: 8, borderTop: '1px solid #e2e8f0' }}>{c.lote}</td>
                <td style={{ padding: 8, borderTop: '1px solid #e2e8f0' }}>{c.cantidad_disponible}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Producto final</h3>
      {data.inventario_final.length === 0 ? (
        <p style={{ color: '#64748b' }}>Sin cajas en inventario.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th style={{ padding: 8 }}>Calidad</th>
              <th style={{ padding: 8 }}>Tipo de caja</th>
              <th style={{ padding: 8 }}>Lote</th>
              <th style={{ padding: 8 }}>Cajas</th>
            </tr>
          </thead>
          <tbody>
            {data.inventario_final.map((i) => (
              <tr key={i.id}>
                <td style={{ padding: 8, borderTop: '1px solid #e2e8f0' }}>{i.calidad === 'segunda' ? '2da' : '1ra'}</td>
                <td style={{ padding: 8, borderTop: '1px solid #e2e8f0' }}>{i.tipo_caja}</td>
                <td style={{ padding: 8, borderTop: '1px solid #e2e8f0' }}>{i.lote}</td>
                <td style={{ padding: 8, borderTop: '1px solid #e2e8f0' }}>{i.cantidad_stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Embarques({ data }: { data: ReporteCatalogo }) {
  if (data.embarques.length === 0) return <p style={{ color: '#64748b' }}>Sin embarques de {data.nombre}.</p>;
  return (
    <div style={{ marginTop: 12 }}>
      {data.embarques.map((e) => (
        <div key={e.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <strong>
            {e.fecha_salida} · {e.cliente}
          </strong>
          <ul style={{ margin: '8px 0 0' }}>
            {e.lineas.map((l, i) => (
              <li key={i}>
                {l.calidad === 'segunda' ? '2da' : '1ra'} · {l.tipo_caja} · {l.lote}: {l.cantidad} cajas
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
