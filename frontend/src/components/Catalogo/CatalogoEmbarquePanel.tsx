import { useEffect, useState } from 'react';
import type { Cliente } from '../../types';
import {
  crearEmbarqueCatalogo,
  listarInventarioCatalogo,
  mensajeError,
  type InventarioCatalogo,
} from '../../lib/catalogoApi';

interface Linea {
  inventarioId: number;
  cantidad: number;
  etiqueta: string;
}

interface Props {
  token: string;
  clientes: Cliente[];
}

export default function CatalogoEmbarquePanel({ token, clientes }: Props) {
  const [stock, setStock] = useState<InventarioCatalogo[]>([]);
  const [sel, setSel] = useState('');
  const [cant, setCant] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [busy, setBusy] = useState(false);

  const cargar = () =>
    listarInventarioCatalogo(token)
      .then(setStock)
      .catch(() => setStock([]));

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (stock.length === 0 && lineas.length === 0) return null;

  const item = stock.find((s) => String(s.id) === sel);
  const ya = lineas.find((l) => l.inventarioId === item?.id)?.cantidad || 0;
  const disp = item ? item.cantidad_stock - ya : 0;

  const agregar = () => {
    if (!item) return alert('Elige una existencia');
    const n = parseInt(cant, 10);
    if (!Number.isInteger(n) || n <= 0) return alert('Indica la cantidad');
    if (n > disp) return alert(`Solo hay ${disp} cajas disponibles`);
    const etiqueta = `${item.producto} · ${item.calidad === 'segunda' ? '2da' : '1ra'} · ${item.tipo_caja} · ${item.lote}`;
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.inventarioId === item.id);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], cantidad: copy[i].cantidad + n };
        return copy;
      }
      return [...prev, { inventarioId: item.id, cantidad: n, etiqueta }];
    });
    setCant('');
  };

  const confirmar = async () => {
    if (!clienteId) return alert('Selecciona un cliente');
    if (lineas.length === 0) return alert('Agrega al menos una línea');
    setBusy(true);
    try {
      await crearEmbarqueCatalogo(token, {
        cliente_id: Number(clienteId),
        lineas: lineas.map((l) => ({ inventario_id: l.inventarioId, cantidad: l.cantidad })),
      });
      alert('Embarque registrado');
      setLineas([]);
      await cargar();
    } catch (err) {
      alert(mensajeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
      <h3>Productos nuevos — inventario final</h3>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        Estas cajas no se mezclan con el inventario de uva, limón o melón.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ padding: 10, minWidth: 280, flex: 1 }}>
          <option value="">Seleccionar existencia</option>
          {stock.map((s) => (
            <option key={s.id} value={s.id}>
              {s.producto} · {s.calidad === 'segunda' ? '2da' : '1ra'} · {s.tipo_caja} · {s.lote} · {s.cantidad_stock}{' '}
              cajas
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          value={cant}
          onChange={(e) => setCant(e.target.value)}
          placeholder="Cantidad"
          style={{ padding: 10, width: 120 }}
        />
        <button type="button" onClick={agregar}>
          Agregar línea
        </button>
      </div>
      {item && (
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Disponibles para este embarque: <strong>{disp}</strong>
        </p>
      )}
      {lineas.map((l) => (
        <div key={l.inventarioId} style={{ padding: '8px 0', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {l.etiqueta} · <strong>{l.cantidad}</strong> cajas
          </span>
          <button type="button" onClick={() => setLineas(lineas.filter((x) => x.inventarioId !== l.inventarioId))}>
            Quitar
          </button>
        </div>
      ))}
      <label style={{ display: 'block', marginTop: 8, fontSize: 13, fontWeight: 700 }}>Cliente</label>
      <select
        value={clienteId}
        onChange={(e) => setClienteId(e.target.value)}
        style={{ padding: 10, minWidth: 240, margin: '6px 0 12px' }}
      >
        <option value="">Seleccionar cliente</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      <button type="button" onClick={confirmar} disabled={busy || lineas.length === 0} style={{ padding: '12px 20px' }}>
        {busy ? 'Registrando…' : 'Confirmar embarque de productos nuevos'}
      </button>
    </div>
  );
}
