import { useEffect, useState, type CSSProperties } from 'react';
import {
  crearEmpaqueCatalogo,
  listarCampoCatalogo,
  listarProductosCatalogo,
  mensajeError,
  type CampoCatalogo,
  type ProductoCatalogo,
} from '../../lib/catalogoApi';

interface Linea {
  key: string;
  parametroId: string;
  cantidad: string;
}

interface Props {
  token: string;
  codigo: string;
  onDone: () => void;
}

const input: CSSProperties = {
  width: '100%',
  padding: 10,
  boxSizing: 'border-box',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
};

export default function CatalogoEmpaqueForm({ token, codigo, onDone }: Props) {
  const [producto, setProducto] = useState<ProductoCatalogo | null>(null);
  const [campo, setCampo] = useState<CampoCatalogo[]>([]);
  const [lote, setLote] = useState('');
  const [usarForma, setUsarForma] = useState<Record<string, string>>({});
  const [fecha, setFecha] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([{ key: '1', parametroId: '', cantidad: '' }]);
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    const rows = await listarProductosCatalogo(token);
    const prod = rows.find((p) => p.codigo === codigo) || null;
    setProducto(prod);
    if (prod) setCampo(await listarCampoCatalogo(token, prod.id));
  };

  useEffect(() => {
    cargar().catch(() => setProducto(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, codigo]);

  if (!producto) return <p style={{ color: '#64748b' }}>Cargando producto…</p>;
  if (!producto.configurado) {
    return <p style={{ color: '#92400e' }}>Configura el producto en Ajustes generales antes de empacar.</p>;
  }

  const delLote = campo.filter((c) => c.lote === lote);
  const lotes = [...new Map(campo.map((c) => [c.lote, c])).values()];

  const registrar = async () => {
    if (!lote) return alert('Elige el lote del que vas a empacar');
    const consumos: Array<{ codigo: string; cantidad: number }> = [];
    for (const fila of delLote) {
      const raw = usarForma[fila.codigo] || '';
      if (!raw.trim()) continue;
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n) || n <= 0) return alert(`Cantidad inválida de ${fila.nombre}`);
      if (n > fila.cantidad_disponible) {
        return alert(`Solo hay ${fila.cantidad_disponible} de ${fila.nombre}`);
      }
      consumos.push({ codigo: fila.codigo, cantidad: n });
    }
    if (consumos.length === 0) return alert('Indica cuántos contenedores usar de al menos una forma');
    const payload = [];
    for (const lin of lineas) {
      const cant = parseInt(lin.cantidad, 10);
      if (!lin.parametroId && !lin.cantidad) continue;
      if (!lin.parametroId || !Number.isInteger(cant) || cant <= 0) {
        return alert('Cada línea necesita presentación y cantidad de cajas');
      }
      payload.push({ parametro_id: Number(lin.parametroId), cantidad: cant });
    }
    if (payload.length === 0) return alert('Agrega al menos una línea de empaque');
    setBusy(true);
    try {
      await crearEmpaqueCatalogo(token, {
        producto_id: producto.id,
        lote,
        consumos,
        fecha: fecha || null,
        lineas: payload,
      });
      alert('Empaque registrado. El inventario final ya tiene esas cajas.');
      setUsarForma({});
      setLineas([{ key: String(Date.now()), parametroId: '', cantidad: '' }]);
      await cargar();
      onDone();
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        Empaque de <strong>{producto.nombre}</strong> a partir de lo ya recibido. Si el lote
        mezcla formas, indica cuántos de cada una: cada forma pesa distinto.
      </p>
      {campo.length === 0 ? (
        <p style={{ color: '#92400e' }}>No hay contenedores disponibles. Regístralos primero en Recepción.</p>
      ) : (
        <>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Lote con existencia</label>
          <select
            value={lote}
            onChange={(e) => {
              setLote(e.target.value);
              setUsarForma({});
            }}
            style={{ ...input, margin: '6px 0 10px' }}
          >
            <option value="">Elegir lote</option>
            {lotes.map((c) => (
              <option key={c.lote} value={c.lote}>
                {c.lote}
              </option>
            ))}
          </select>
          {delLote.map((fila) => (
            <div key={fila.codigo} style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>
                {fila.nombre} a usar ({fila.peso_kg} kg c/u · {fila.cantidad_disponible} disponibles)
              </label>
              <input
                type="number"
                min={0}
                value={usarForma[fila.codigo] || ''}
                onChange={(e) => setUsarForma({ ...usarForma, [fila.codigo]: e.target.value })}
                placeholder="0 si no se usa"
                style={{ ...input, maxWidth: 220, marginTop: 6 }}
              />
            </div>
          ))}
          <label style={{ fontSize: 13, fontWeight: 700 }}>Fecha de empaque</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={{ ...input, maxWidth: 220, margin: '6px 0 12px' }}
          />
          <h4 style={{ marginBottom: 8 }}>Cajas producidas</h4>
          {lineas.map((lin) => (
            <div key={lin.key} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <select
                value={lin.parametroId}
                onChange={(e) =>
                  setLineas(lineas.map((r) => (r.key === lin.key ? { ...r, parametroId: e.target.value } : r)))
                }
                style={{ ...input, flex: 1, minWidth: 220 }}
              >
                <option value="">Presentación</option>
                {producto.parametros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.calidad === 'segunda' ? '2da' : '1ra'} · {p.tipo_caja} · {p.kg} kg · {p.cajas_por_parrilla}{' '}
                    cajas/parrilla
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                placeholder="Cajas"
                value={lin.cantidad}
                onChange={(e) =>
                  setLineas(lineas.map((r) => (r.key === lin.key ? { ...r, cantidad: e.target.value } : r)))
                }
                style={{ ...input, width: 120 }}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setLineas([...lineas, { key: String(Date.now()), parametroId: '', cantidad: '' }])
            }
            style={{ marginBottom: 12 }}
          >
            Agregar línea
          </button>
          <div>
            <button type="button" onClick={registrar} disabled={busy} style={{ padding: '12px 24px' }}>
              {busy ? 'Registrando…' : 'Registrar empaque'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
