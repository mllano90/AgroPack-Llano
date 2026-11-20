import { useEffect, useState } from 'react';
import {
  ajustarCampoCatalogo,
  ajustarInventarioCatalogo,
  editarEmbarqueCatalogo,
  editarEmpaqueCatalogo,
  editarRecepcionCatalogo,
  eliminarEmbarqueCatalogo,
  eliminarEmpaqueCatalogo,
  eliminarRecepcionCatalogo,
  historialCorreccionesCatalogo,
  listarCampoCatalogo,
  listarInventarioCatalogo,
  mensajeError,
  type HistorialCatalogo,
  type InventarioCatalogo,
  type CampoCatalogo,
} from '../../lib/catalogoApi';

type Seccion = 'historial' | 'recepciones' | 'empaques' | 'embarques' | 'inventarios';

interface Props {
  token: string;
  productoId: number;
  nombre: string;
}

export default function CorreccionesCatalogo({ token, productoId, nombre }: Props) {
  const [seccion, setSeccion] = useState<Seccion>('historial');
  const [data, setData] = useState<HistorialCatalogo | null>(null);
  const [campo, setCampo] = useState<CampoCatalogo[]>([]);
  const [finales, setFinales] = useState<InventarioCatalogo[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    const [hist, camp, inv] = await Promise.all([
      historialCorreccionesCatalogo(token, productoId),
      listarCampoCatalogo(token, productoId),
      listarInventarioCatalogo(token, productoId),
    ]);
    setData(hist);
    setCampo(camp);
    setFinales(inv);
  };

  useEffect(() => {
    cargar().catch((err) => setError(mensajeError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, productoId]);

  const run = async (fn: () => Promise<unknown>, hecho: string) => {
    setBusy(true);
    setError('');
    setOk('');
    try {
      await fn();
      setOk(hecho);
      await cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  tokenHolder.token = token;

  const btn = (id: Seccion, label: string) => (
    <button
      type="button"
      onClick={() => setSeccion(id)}
      style={{
        padding: '8px 14px',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        fontWeight: seccion === id ? 700 : 500,
        background: seccion === id ? '#0f172a' : '#f1f5f9',
        color: seccion === id ? 'white' : '#334155',
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
        {btn('historial', 'Historial de movimientos')}
        {btn('recepciones', 'Corregir recepciones')}
        {btn('empaques', 'Corregir empaques')}
        {btn('embarques', 'Corregir embarques')}
        {btn('inventarios', 'Inventarios')}
      </div>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {ok && <p style={{ color: '#15803d' }}>{ok}</p>}
      {!data ? (
        <p style={{ color: '#64748b' }}>Cargando {nombre}…</p>
      ) : (
        <>
          {seccion === 'historial' && <Historial data={data} />}
          {seccion === 'recepciones' && <Recepciones data={data} busy={busy} onRun={run} />}
          {seccion === 'empaques' && <Empaques data={data} busy={busy} onRun={run} />}
          {seccion === 'embarques' && <Embarques data={data} busy={busy} onRun={run} />}
          {seccion === 'inventarios' && (
            <Inventarios
              productoId={productoId}
              campo={campo}
              finales={finales}
              busy={busy}
              onRun={run}
            />
          )}
        </>
      )}
    </div>
  );
}

function Historial({ data }: { data: HistorialCatalogo }) {
  return (
    <div>
      <h3>Recepciones</h3>
      {data.recepciones.length === 0 && <p style={{ color: '#64748b' }}>Sin recepciones.</p>}
      {data.recepciones.map((r) => (
        <p key={r.id}>
          #{r.id} · {r.fecha} · {r.lote} · {r.kg.toLocaleString('en-US')} kg ·{' '}
          {r.lineas.map((l) => `${l.nombre} ${l.cantidad}`).join(', ')}
        </p>
      ))}
      <h3>Empaques</h3>
      {data.empaques.length === 0 && <p style={{ color: '#64748b' }}>Sin empaques.</p>}
      {data.empaques.map((e) => (
        <p key={e.id}>
          #{e.id} · {e.fecha} · {e.lote} · campo{' '}
          {e.consumos.map((c) => `${c.nombre} ${c.cantidad}`).join(', ')} · cajas{' '}
          {e.lineas.map((l) => `${l.calidad === 'segunda' ? '2da' : '1ra'} ${l.tipo_caja} ${l.cantidad}`).join(', ')}
        </p>
      ))}
      <h3>Embarques</h3>
      {data.embarques.length === 0 && <p style={{ color: '#64748b' }}>Sin embarques.</p>}
      {data.embarques.map((e) => (
        <p key={e.id}>
          #{e.id} · {e.fecha_salida} · {e.cliente} ·{' '}
          {e.lineas.map((l) => `${l.tipo_caja} ${l.cantidad}`).join(', ')}
        </p>
      ))}
    </div>
  );
}

function Recepciones({
  data,
  busy,
  onRun,
}: {
  data: HistorialCatalogo;
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  return (
    <div>
      {data.recepciones.map((r) => (
        <RecepcionRow key={r.id} rec={r} busy={busy} onRun={onRun} />
      ))}
      {data.recepciones.length === 0 && <p style={{ color: '#64748b' }}>Sin recepciones.</p>}
    </div>
  );
}

function RecepcionRow({
  rec,
  busy,
  onRun,
}: {
  rec: HistorialCatalogo['recepciones'][number];
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  const [lineas, setLineas] = useState(rec.lineas.map((l) => ({ codigo: l.codigo, cantidad: String(l.cantidad), nombre: l.nombre })));
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <strong>
        Recepción #{rec.id} · {rec.lote} · {rec.fecha}
      </strong>
      {lineas.map((l, i) => (
        <div key={l.codigo} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <span style={{ minWidth: 140 }}>{l.nombre}</span>
          <input
            type="number"
            min={1}
            value={l.cantidad}
            onChange={(e) =>
              setLineas(lineas.map((row, j) => (j === i ? { ...row, cantidad: e.target.value } : row)))
            }
            style={{ width: 100, padding: 8 }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onRun(
              () =>
                editarRecepcionCatalogo(tokenHolder.token, rec.id, {
                  lineas: lineas.map((l) => ({ codigo: l.codigo, cantidad: parseInt(l.cantidad, 10) })),
                }),
              `Recepción #${rec.id} actualizada`
            )
          }
        >
          Guardar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!confirm(`¿Eliminar la recepción #${rec.id}? Se devuelve el inventario de cada forma.`)) return;
            onRun(() => eliminarRecepcionCatalogo(tokenHolder.token, rec.id), `Recepción #${rec.id} eliminada`);
          }}
          style={{ color: '#b91c1c' }}
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

function Empaques({
  data,
  busy,
  onRun,
}: {
  data: HistorialCatalogo;
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  return (
    <div>
      {data.empaques.map((e) => (
        <EmpaqueRow key={e.id} emp={e} producto={data.producto} busy={busy} onRun={onRun} />
      ))}
      {data.empaques.length === 0 && <p style={{ color: '#64748b' }}>Sin empaques.</p>}
    </div>
  );
}

function EmpaqueRow({
  emp,
  producto,
  busy,
  onRun,
}: {
  emp: HistorialCatalogo['empaques'][number];
  producto: HistorialCatalogo['producto'];
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  const [consumos, setConsumos] = useState(emp.consumos.map((c) => ({ ...c, cantidad: String(c.cantidad) })));
  const [lineas, setLineas] = useState(
    emp.lineas.map((l) => ({ parametro_id: String(l.parametro_id), cantidad: String(l.cantidad) }))
  );
  const guardar = () =>
    onRun(
      () =>
        editarEmpaqueCatalogo(tokenHolder.token, emp.id, {
          consumos: consumos.map((c) => ({ codigo: c.codigo, cantidad: parseInt(c.cantidad, 10) })),
          lineas: lineas.map((l) => ({ parametro_id: Number(l.parametro_id), cantidad: parseInt(l.cantidad, 10) })),
        }),
      `Empaque #${emp.id} actualizado`
    );
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <strong>
        Empaque #{emp.id} · {emp.lote} · {emp.fecha}
      </strong>
      {consumos.map((c, i) => (
        <div key={c.codigo} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <span style={{ minWidth: 160 }}>Campo · {c.nombre}</span>
          <input
            type="number"
            min={1}
            value={c.cantidad}
            onChange={(e) =>
              setConsumos(consumos.map((row, j) => (j === i ? { ...row, cantidad: e.target.value } : row)))
            }
            style={{ width: 100, padding: 8 }}
          />
        </div>
      ))}
      {lineas.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select
            value={l.parametro_id}
            onChange={(e) =>
              setLineas(lineas.map((row, j) => (j === i ? { ...row, parametro_id: e.target.value } : row)))
            }
            style={{ padding: 8, flex: 1 }}
          >
            {producto.parametros.map((p) => (
              <option key={p.id} value={p.id}>
                {p.calidad === 'segunda' ? '2da' : '1ra'} · {p.tipo_caja}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={l.cantidad}
            onChange={(e) =>
              setLineas(lineas.map((row, j) => (j === i ? { ...row, cantidad: e.target.value } : row)))
            }
            style={{ width: 100, padding: 8 }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" disabled={busy} onClick={guardar}>
          Guardar
        </button>
        <button
          type="button"
          disabled={busy}
          style={{ color: '#b91c1c' }}
          onClick={() => {
            if (!confirm(`¿Eliminar el empaque #${emp.id}? Vuelven los contenedores y se quitan las cajas.`)) return;
            onRun(() => eliminarEmpaqueCatalogo(tokenHolder.token, emp.id), `Empaque #${emp.id} eliminado`);
          }}
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

function Embarques({
  data,
  busy,
  onRun,
}: {
  data: HistorialCatalogo;
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  return (
    <div>
      {data.embarques.map((e) => (
        <EmbarqueRow key={e.id} emb={e} busy={busy} onRun={onRun} />
      ))}
      {data.embarques.length === 0 && <p style={{ color: '#64748b' }}>Sin embarques.</p>}
    </div>
  );
}

function EmbarqueRow({
  emb,
  busy,
  onRun,
}: {
  emb: HistorialCatalogo['embarques'][number];
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  const [lineas, setLineas] = useState(emb.lineas.map((l) => ({ ...l, cantidad: String(l.cantidad) })));
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <strong>
        Embarque #{emb.id} · {emb.cliente} · {emb.fecha_salida}
      </strong>
      {lineas.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <span style={{ minWidth: 180 }}>
            {l.calidad === 'segunda' ? '2da' : '1ra'} · {l.tipo_caja} · {l.lote}
          </span>
          <input
            type="number"
            min={1}
            value={l.cantidad}
            onChange={(e) =>
              setLineas(lineas.map((row, j) => (j === i ? { ...row, cantidad: e.target.value } : row)))
            }
            style={{ width: 100, padding: 8 }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onRun(
              () =>
                editarEmbarqueCatalogo(tokenHolder.token, emb.id, {
                  lineas: lineas.map((l) => ({
                    tipo_caja_id: l.tipo_caja_id,
                    calidad: l.calidad,
                    lote: l.lote,
                    cantidad: parseInt(l.cantidad, 10),
                  })),
                }),
              `Embarque #${emb.id} actualizado`
            )
          }
        >
          Guardar
        </button>
        <button
          type="button"
          disabled={busy}
          style={{ color: '#b91c1c' }}
          onClick={() => {
            if (!confirm(`¿Eliminar el embarque #${emb.id}? Las cajas vuelven al inventario final.`)) return;
            onRun(() => eliminarEmbarqueCatalogo(tokenHolder.token, emb.id), `Embarque #${emb.id} eliminado`);
          }}
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

function Inventarios({
  productoId,
  campo,
  finales,
  busy,
  onRun,
}: {
  productoId: number;
  campo: CampoCatalogo[];
  finales: InventarioCatalogo[];
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, hecho: string) => Promise<void>;
}) {
  const [campoEdit, setCampoEdit] = useState<Record<string, string>>({});
  const [finalEdit, setFinalEdit] = useState<Record<number, string>>({});
  return (
    <div>
      <h3>Campo por forma</h3>
      {campo.length === 0 && <p style={{ color: '#64748b' }}>Sin existencia de campo.</p>}
      {campo.map((c) => {
        const key = `${c.lote}|${c.codigo}`;
        const valor = campoEdit[key] ?? String(c.cantidad_disponible);
        return (
          <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ minWidth: 220 }}>
              {c.lote} · {c.nombre}
            </span>
            <input
              type="number"
              min={0}
              value={valor}
              onChange={(e) => setCampoEdit({ ...campoEdit, [key]: e.target.value })}
              style={{ width: 100, padding: 8 }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onRun(
                  () =>
                    ajustarCampoCatalogo(tokenHolder.token, {
                      producto_id: productoId,
                      lote: c.lote,
                      codigo: c.codigo,
                      cantidad: parseInt(valor, 10),
                    }),
                  'Inventario de campo actualizado'
                )
              }
            >
              Guardar
            </button>
          </div>
        );
      })}
      <h3>Producto final</h3>
      {finales.length === 0 && <p style={{ color: '#64748b' }}>Sin cajas en inventario final.</p>}
      {finales.map((i) => {
        const valor = finalEdit[i.id] ?? String(i.cantidad_stock);
        return (
          <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ minWidth: 280 }}>
              {i.calidad === 'segunda' ? '2da' : '1ra'} · {i.tipo_caja} · {i.lote}
            </span>
            <input
              type="number"
              min={0}
              value={valor}
              onChange={(e) => setFinalEdit({ ...finalEdit, [i.id]: e.target.value })}
              style={{ width: 100, padding: 8 }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onRun(
                  () => ajustarInventarioCatalogo(tokenHolder.token, i.id, parseInt(valor, 10)),
                  'Inventario final actualizado'
                )
              }
            >
              Guardar
            </button>
          </div>
        );
      })}
    </div>
  );
}

const tokenHolder = { token: '' };
