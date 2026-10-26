import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  crearReempaqueMelon,
  getReempaqueMelonDisponibles,
  getReempaqueMelonHistorial,
  type ReempaqueMelonLinea,
} from '../../lib/api';
import {
  FILAS_CAJA_MELON,
  cajasPorParrillaMelon,
  labelCalidadMelon,
  labelPresentacionMelon,
  tallasParaPresentacionMelon,
} from '../../lib/constants';
import { formatFechaCorta, toInputDate } from '../../lib/dates';

type Props = {
  token: string;
  onDone?: () => void;
};

type SalidaDraft = ReempaqueMelonLinea & { seleccionar: number };
type ResultadoDraft = {
  presentacion: string;
  talla: string;
  calidad: string;
  cantidad: string;
};

const box: CSSProperties = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 16,
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
};
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 14,
};

function lineKey(l: {
  empaque_id?: number;
  presentacion: string;
  talla: string;
  calidad: string;
  lote: string;
}) {
  return `${l.empaque_id || ''}|${l.presentacion}|${l.talla}|${l.calidad}|${l.lote}`;
}

export default function MelonReempaque({ token, onDone }: Props) {
  const today = toInputDate(new Date().toISOString().slice(0, 10));
  const [fechaOrigen, setFechaOrigen] = useState(today);
  const [fechaReempaque, setFechaReempaque] = useState(today);
  const [lineas, setLineas] = useState<SalidaDraft[]>([]);
  const [procesos, setProcesos] = useState<
    Array<{ empaque_id: number; lote: string; cajas: number; bins: number }>
  >([]);
  const [filtroProceso, setFiltroProceso] = useState<number | 'todos'>('todos');
  const [resultados, setResultados] = useState<ResultadoDraft[]>([
    { presentacion: 'caja_normal_b', talla: '9', calidad: 'llano', cantidad: '' },
  ]);
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [historial, setHistorial] = useState<any[]>([]);

  const cargarHistorial = useCallback(async () => {
    try {
      const h = await getReempaqueMelonHistorial(token, 100);
      setHistorial(h.items || []);
    } catch {
      /* ignore */
    }
  }, [token]);

  const cargarDisponibles = useCallback(async () => {
    if (!fechaOrigen) return;
    setLoading(true);
    setError('');
    setOkMsg('');
    try {
      const data = await getReempaqueMelonDisponibles(token, fechaOrigen);
      setProcesos(data.procesos || []);
      setLineas(
        (data.lineas || []).map((l) => ({
          ...l,
          talla: String(l.talla || ''),
          calidad: String(l.calidad || 'llano'),
          lote: String(l.lote || ''),
          seleccionar: 0,
        }))
      );
      setFiltroProceso('todos');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron cargar las cajas de ese día');
      setLineas([]);
      setProcesos([]);
    } finally {
      setLoading(false);
    }
  }, [token, fechaOrigen]);

  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  useEffect(() => {
    cargarDisponibles();
  }, [cargarDisponibles]);

  const lineasVisibles = useMemo(() => {
    if (filtroProceso === 'todos') return lineas;
    return lineas.filter((l) => l.empaque_id === filtroProceso);
  }, [lineas, filtroProceso]);

  const totalSalida = lineas.reduce((s, l) => s + (Number(l.seleccionar) || 0), 0);
  const totalResultado = resultados.reduce((s, r) => s + (parseInt(r.cantidad, 10) || 0), 0);
  const merma = Math.max(0, totalSalida - totalResultado);

  const setSeleccionar = (key: string, val: number) => {
    setLineas((prev) =>
      prev.map((l) =>
        lineKey(l) === key
          ? { ...l, seleccionar: Math.max(0, Math.min(l.cantidad, Math.floor(val) || 0)) }
          : l
      )
    );
  };

  const handleRegistrar = async () => {
    const salidas = lineas
      .filter((l) => (Number(l.seleccionar) || 0) > 0)
      .map((l) => ({
        empaque_id: l.empaque_id,
        presentacion: l.presentacion,
        talla: l.talla || null,
        calidad: l.calidad || 'llano',
        lote: l.lote || null,
        cantidad: Number(l.seleccionar),
      }));
    if (salidas.length === 0) {
      return alert('Selecciona al menos una cantidad de cajas a reempacar');
    }
    const resLines = resultados
      .map((r) => ({
        presentacion: r.presentacion,
        talla: r.talla || null,
        calidad: r.calidad || 'llano',
        cantidad: parseInt(r.cantidad, 10) || 0,
      }))
      .filter((r) => r.cantidad > 0);
    if (resLines.length === 0) {
      return alert('Indica el resultado en cajas recuperadas');
    }
    if (totalResultado > totalSalida) {
      return alert('El resultado no puede superar las cajas salidas');
    }
    if (
      !confirm(
        `¿Registrar reempaque?\n\n` +
          `Origen: ${fechaOrigen}\n` +
          `Fecha reempaque: ${fechaReempaque}\n` +
          `Salen: ${totalSalida} cajas\n` +
          `Recuperan: ${totalResultado} cajas\n` +
          `Merma: ${merma} cajas\n\n` +
          `Las cajas recuperadas se integran al proceso del día de origen (no al día del reempaque).`
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await crearReempaqueMelon(token, {
        fecha_origen: fechaOrigen,
        fecha_reempaque: fechaReempaque,
        mercado: 'nacional',
        salidas,
        resultados: resLines,
        notas: notas.trim() || null,
      });
      setOkMsg(res.message);
      setResultados([
        { presentacion: 'caja_normal_b', talla: '9', calidad: 'llano', cantidad: '' },
      ]);
      setNotas('');
      await cargarDisponibles();
      await cargarHistorial();
      onDone?.();
    } catch (err: any) {
      const d = err?.response?.data?.detail;
      setError(typeof d === 'string' ? d : 'No se pudo registrar el reempaque');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Reempaque melón</h3>
      <p style={{ fontSize: 13, color: '#64748b', maxWidth: 900, marginTop: 0 }}>
        Descuenta cajas de un proceso ya empacado (día de origen), registra el reproceso en la
        fecha de reempaque y <strong>devuelve el resultado al proceso original</strong> para no
        afectar rendimientos del día en que se reempacó. La merma = cajas salidas − recuperadas.
      </p>

      {error && (
        <div
          style={{
            background: '#fef2f2',
            color: '#b91c1c',
            padding: 12,
            borderRadius: 8,
            marginBottom: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}
      {okMsg && (
        <div
          style={{
            background: '#f0fdf4',
            color: '#166534',
            padding: 12,
            borderRadius: 8,
            marginBottom: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {okMsg}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <label style={labelStyle}>
          Fecha origen (proceso original)
          <input
            type="date"
            value={fechaOrigen}
            onChange={(e) => setFechaOrigen(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Fecha del reempaque
          <input
            type="date"
            value={fechaReempaque}
            onChange={(e) => setFechaReempaque(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Filtrar proceso
          <select
            value={filtroProceso === 'todos' ? 'todos' : String(filtroProceso)}
            onChange={(e) =>
              setFiltroProceso(e.target.value === 'todos' ? 'todos' : Number(e.target.value))
            }
            style={inputStyle}
          >
            <option value="todos">Todos los del día</option>
            {procesos.map((p) => (
              <option key={p.empaque_id} value={p.empaque_id}>
                #{p.empaque_id} · {p.lote} · {p.cajas} cajas
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            type="button"
            onClick={cargarDisponibles}
            disabled={loading}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {loading ? 'Cargando…' : 'Actualizar cajas'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* Izquierda: cajas del día */}
        <div style={box}>
          <h4 style={{ marginTop: 0 }}>Cajas del {formatFechaCorta(fechaOrigen)}</h4>
          {loading ? (
            <p>Cargando…</p>
          ) : lineasVisibles.length === 0 ? (
            <p style={{ color: '#64748b' }}>No hay producción melón ese día.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={th}>Proc.</th>
                    <th style={th}>Caja</th>
                    <th style={th}>Talla</th>
                    <th style={th}>Calidad</th>
                    <th style={th}>Lote</th>
                    <th style={th}>Disp.</th>
                    <th style={th}>A reempacar</th>
                  </tr>
                </thead>
                <tbody>
                  {lineasVisibles.map((l) => {
                    const k = lineKey(l);
                    const cpp = cajasPorParrillaMelon(l.presentacion);
                    return (
                      <tr key={k} style={{ borderTop: '1px solid #e2e8f0' }}>
                        <td style={td}>#{l.empaque_id}</td>
                        <td style={td}>{labelPresentacionMelon(l.presentacion)}</td>
                        <td style={td}>#{l.talla}s</td>
                        <td style={td}>{labelCalidadMelon(l.calidad)}</td>
                        <td style={td}>{l.lote || '—'}</td>
                        <td style={td}>
                          {l.cantidad}
                          {cpp > 0 ? (
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>
                              {' '}
                              (~{(l.cantidad / cpp).toFixed(1)} parr)
                            </span>
                          ) : null}
                        </td>
                        <td style={td}>
                          <input
                            type="number"
                            min={0}
                            max={l.cantidad}
                            value={l.seleccionar || ''}
                            onChange={(e) => setSeleccionar(k, Number(e.target.value))}
                            style={{ ...inputStyle, width: 90 }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginBottom: 0, fontWeight: 700 }}>
            Total a reempacar: {totalSalida} cajas
          </p>
        </div>

        {/* Derecha: resultado */}
        <div style={box}>
          <h4 style={{ marginTop: 0 }}>Resultado del reempaque</h4>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            Cajas recuperadas (vuelven al proceso del día de origen).
          </p>
          {resultados.map((r, i) => {
            const tallas = tallasParaPresentacionMelon(r.presentacion);
            return (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 70px 90px 80px auto',
                  gap: 8,
                  marginBottom: 8,
                  alignItems: 'end',
                }}
              >
                <label style={labelStyle}>
                  Caja
                  <select
                    value={r.presentacion}
                    onChange={(e) => {
                      const presentacion = e.target.value;
                      const ts = tallasParaPresentacionMelon(presentacion);
                      const next = [...resultados];
                      next[i] = {
                        ...next[i],
                        presentacion,
                        talla: ts[0] || next[i].talla,
                      };
                      setResultados(next);
                    }}
                    style={inputStyle}
                  >
                    {FILAS_CAJA_MELON.map((f) => (
                      <option key={f.presentacion} value={f.presentacion}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Talla
                  <select
                    value={r.talla}
                    onChange={(e) => {
                      const next = [...resultados];
                      next[i] = { ...next[i], talla: e.target.value };
                      setResultados(next);
                    }}
                    style={inputStyle}
                  >
                    {tallas.map((t) => (
                      <option key={t} value={t}>
                        #{t}s
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Calidad
                  <select
                    value={r.calidad}
                    onChange={(e) => {
                      const next = [...resultados];
                      next[i] = { ...next[i], calidad: e.target.value };
                      setResultados(next);
                    }}
                    style={inputStyle}
                  >
                    <option value="llano">{labelCalidadMelon('llano')}</option>
                    <option value="wallys">{labelCalidadMelon('wallys')}</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  Cajas
                  <input
                    type="number"
                    min={0}
                    value={r.cantidad}
                    onChange={(e) => {
                      const next = [...resultados];
                      next[i] = { ...next[i], cantidad: e.target.value };
                      setResultados(next);
                    }}
                    style={inputStyle}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setResultados(resultados.filter((_, j) => j !== i))}
                  style={{
                    padding: '8px 10px',
                    background: '#fee2e2',
                    color: '#b91c1c',
                    border: '1px solid #fecaca',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Quitar
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setResultados([
                ...resultados,
                {
                  presentacion: FILAS_CAJA_MELON[0].presentacion,
                  talla: FILAS_CAJA_MELON[0].tallas[0],
                  calidad: 'llano',
                  cantidad: '',
                },
              ])
            }
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px dashed #94a3b8',
              background: '#f8fafc',
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            + Agregar línea resultado
          </button>

          <label style={{ ...labelStyle, marginBottom: 12 }}>
            Notas
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              style={inputStyle}
              placeholder="Opcional"
            />
          </label>

          <div
            style={{
              background: '#fff7ed',
              border: '1px solid #fdba74',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            <div>
              Salidas: <strong>{totalSalida}</strong>
            </div>
            <div>
              Recuperadas: <strong>{totalResultado}</strong>
            </div>
            <div>
              Merma: <strong style={{ color: merma > 0 ? '#c2410c' : undefined }}>{merma}</strong>
            </div>
          </div>

          <button
            type="button"
            disabled={busy || totalSalida <= 0 || totalResultado <= 0}
            onClick={handleRegistrar}
            style={{
              padding: '12px 18px',
              background: '#0f766e',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
              width: '100%',
            }}
          >
            {busy ? 'Registrando…' : 'Confirmar reempaque'}
          </button>
        </div>
      </div>

      {/* Historial */}
      <div style={{ ...box, marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h4 style={{ margin: 0 }}>Historial de reempaques</h4>
          <button
            type="button"
            onClick={cargarHistorial}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            Actualizar
          </button>
        </div>
        {historial.length === 0 ? (
          <p style={{ color: '#64748b', marginBottom: 0 }}>Aún no hay reempaques registrados.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f0fdfa', textAlign: 'left' }}>
                  <th style={th}>#</th>
                  <th style={th}>Fecha reempaque</th>
                  <th style={th}>Origen</th>
                  <th style={th}>Procesos</th>
                  <th style={th}>Salidas</th>
                  <th style={th}>Resultado</th>
                  <th style={th}>Merma</th>
                  <th style={th}>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={td}>{h.id}</td>
                    <td style={td}>{formatFechaCorta(h.fecha_reempaque)}</td>
                    <td style={td}>{formatFechaCorta(h.fecha_origen)}</td>
                    <td style={td}>
                      {(h.procesos_origen || []).map((id: number) => `#${id}`).join(', ') || '—'}
                    </td>
                    <td style={td}>{h.cajas_salidas}</td>
                    <td style={td}>{h.cajas_resultado}</td>
                    <td style={{ ...td, color: h.merma_cajas > 0 ? '#c2410c' : undefined }}>
                      {h.merma_cajas}
                    </td>
                    <td style={td}>{h.registrado_por || h.empacador || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const th: CSSProperties = { padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
