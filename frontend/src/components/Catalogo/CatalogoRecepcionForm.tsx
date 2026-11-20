import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  crearRecepcionCatalogo,
  listarProductosCatalogo,
  mensajeError,
  type FormaCosecha,
  type ProductoCatalogo,
} from '../../lib/catalogoApi';

interface Props {
  token: string;
  codigo: string;
  onDone: () => void;
}

interface Fila {
  key: string;
  codigo: string;
  cantidad: string;
}

const input: CSSProperties = {
  width: '100%',
  padding: 12,
  margin: '8px 0',
  boxSizing: 'border-box',
};

export default function CatalogoRecepcionForm({ token, codigo, onDone }: Props) {
  const [producto, setProducto] = useState<ProductoCatalogo | null>(null);
  const [lote, setLote] = useState('');
  const [fecha, setFecha] = useState('');
  const [filas, setFilas] = useState<Fila[]>([{ key: '1', codigo: '', cantidad: '' }]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(2);

  useEffect(() => {
    let cancel = false;
    listarProductosCatalogo(token)
      .then((rows) => {
        if (cancel) return;
        const prod = rows.find((p) => p.codigo === codigo) || null;
        setProducto(prod);
        const formas = formasDe(prod);
        if (formas.length === 1) {
          setFilas([{ key: '1', codigo: formas[0].codigo, cantidad: '' }]);
        }
      })
      .catch(() => {
        if (!cancel) setProducto(null);
      });
    return () => {
      cancel = true;
    };
  }, [token, codigo]);

  if (!producto) return <p style={{ color: '#64748b' }}>Cargando producto…</p>;
  const formas = formasDe(producto);
  if (!producto.configurado || formas.length === 0) {
    return (
      <p style={{ color: '#92400e' }}>
        {producto.nombre} todavía no tiene peso ni tipos de caja. Termina la configuración en Ajustes
        generales.
      </p>
    );
  }

  const usados = new Set(filas.map((f) => f.codigo).filter(Boolean));
  const lineas = filas.map((fila) => {
    const forma = formas.find((f) => f.codigo === fila.codigo);
    const n = parseInt(fila.cantidad, 10);
    const kg = forma && Number.isInteger(n) && n > 0 ? n * forma.peso_kg : null;
    return { fila, forma, n, kg };
  });
  const totalKg = lineas.reduce((s, l) => s + (l.kg || 0), 0);

  const registrar = async () => {
    const payload: Array<{ codigo: string; cantidad: number }> = [];
    for (const lin of lineas) {
      const vacia = !lin.fila.codigo && !lin.fila.cantidad.trim();
      if (vacia) continue;
      if (!lin.forma) return alert('Elige la forma de cosecha de cada línea');
      if (!Number.isInteger(lin.n) || lin.n <= 0) return alert(`Indica la cantidad de ${lin.forma.nombre}`);
      payload.push({ codigo: lin.forma.codigo, cantidad: lin.n });
    }
    if (payload.length === 0) return alert('Agrega al menos una forma y su cantidad');
    if (new Set(payload.map((p) => p.codigo)).size !== payload.length) {
      return alert('No repitas la misma forma en esta recepción');
    }
    setBusy(true);
    try {
      await crearRecepcionCatalogo(token, {
        producto_id: producto.id,
        lote: lote.trim() || 'General',
        fecha: fecha || null,
        lineas: payload,
      });
      alert('Recepción registrada. Ya se puede empacar desde ese lote.');
      setLote('');
      setFilas([
        {
          key: String(seq.current++),
          codigo: formas.length === 1 ? formas[0].codigo : '',
          cantidad: '',
        },
      ]);
      onDone();
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        {producto.nombre}. En la misma recepción puedes anotar varias formas (cajas y bins). Los kilos
        de cada línea son cantidad × su peso.
      </p>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Lote</label>
      <input
        value={lote}
        onChange={(e) => setLote(e.target.value)}
        placeholder="Lote (si lo dejas vacío se usa General)"
        style={input}
      />
      {lineas.map(({ fila, forma, n, kg }) => (
        <div key={fila.key} style={{ marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.4fr) 140px auto', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Forma de cosecha</label>
              <select
                value={fila.codigo}
                onChange={(e) =>
                  setFilas(filas.map((r) => (r.key === fila.key ? { ...r, codigo: e.target.value } : r)))
                }
                style={{ ...input, margin: '6px 0 0' }}
              >
                <option value="">Elegir forma</option>
                {formas.map((f) => (
                  <option key={f.codigo} value={f.codigo} disabled={usados.has(f.codigo) && f.codigo !== fila.codigo}>
                    {f.nombre} · {f.peso_kg} kg
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Cantidad</label>
              <input
                type="number"
                min={1}
                value={fila.cantidad}
                onChange={(e) =>
                  setFilas(filas.map((r) => (r.key === fila.key ? { ...r, cantidad: e.target.value } : r)))
                }
                style={{ ...input, margin: '6px 0 0' }}
              />
            </div>
            {filas.length > 1 && (
              <button
                type="button"
                onClick={() => setFilas(filas.filter((r) => r.key !== fila.key))}
                style={{ marginBottom: 8 }}
              >
                Quitar
              </button>
            )}
          </div>
          {kg != null && forma && (
            <p style={{ fontSize: 13, color: '#166534', margin: '4px 0 0' }}>
              {n} × {forma.peso_kg} kg = <strong>{kg.toLocaleString('en-US')} kg</strong>
            </p>
          )}
        </div>
      ))}
      {filas.length < formas.length && (
        <button
          type="button"
          onClick={() => setFilas([...filas, { key: String(seq.current++), codigo: '', cantidad: '' }])}
          style={{ margin: '4px 0 12px' }}
        >
          Agregar forma
        </button>
      )}
      {totalKg > 0 && (
        <p style={{ fontSize: 15, fontWeight: 700, color: '#14532d' }}>
          Total: {totalKg.toLocaleString('en-US')} kg de campo
        </p>
      )}
      <label style={{ fontSize: 13, fontWeight: 600 }}>Fecha</label>
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
      <button type="button" onClick={registrar} disabled={busy} style={{ padding: '12px 24px' }}>
        {busy ? 'Registrando…' : 'Registrar recepción'}
      </button>
    </div>
  );
}

function formasDe(producto: ProductoCatalogo | null): FormaCosecha[] {
  if (!producto) return [];
  if (producto.formas?.length) return producto.formas;
  if (producto.peso_contenedor_kg) {
    return [
      {
        codigo: producto.tipo_cosecha,
        nombre: producto.tipo_cosecha_nombre,
        peso_kg: producto.peso_contenedor_kg,
      },
    ];
  }
  return [];
}
