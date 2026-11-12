import { useEffect, useState, type CSSProperties } from 'react';
import {
  crearRecepcionCatalogo,
  listarProductosCatalogo,
  mensajeError,
  type ProductoCatalogo,
} from '../../lib/catalogoApi';

interface Props {
  token: string;
  codigo: string;
  onDone: () => void;
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
  const [cantidad, setCantidad] = useState('');
  const [fecha, setFecha] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    listarProductosCatalogo(token)
      .then((rows) => {
        if (!cancel) setProducto(rows.find((p) => p.codigo === codigo) || null);
      })
      .catch(() => {
        if (!cancel) setProducto(null);
      });
    return () => {
      cancel = true;
    };
  }, [token, codigo]);

  if (!producto) return <p style={{ color: '#64748b' }}>Cargando producto…</p>;
  if (!producto.configurado) {
    return (
      <p style={{ color: '#92400e' }}>
        {producto.nombre} todavía no tiene peso ni tipos de caja. Termina la configuración en Ajustes
        generales.
      </p>
    );
  }

  const unidad = producto.tipo_cosecha_nombre.toLowerCase();

  const registrar = async () => {
    const n = parseInt(cantidad, 10);
    if (!Number.isInteger(n) || n <= 0) return alert(`Indica cuántos ${unidad}s entran`);
    setBusy(true);
    try {
      await crearRecepcionCatalogo(token, {
        producto_id: producto.id,
        cantidad: n,
        lote: lote.trim() || 'General',
        fecha: fecha || null,
      });
      alert('Recepción registrada. Ya se puede empacar desde ese lote.');
      setCantidad('');
      setLote('');
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
        {producto.nombre}: cosecha en <strong>{producto.tipo_cosecha_nombre}</strong>
        {producto.peso_contenedor_kg != null ? ` · ${producto.peso_contenedor_kg} kg c/u` : ''}.
      </p>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Lote</label>
      <input
        value={lote}
        onChange={(e) => setLote(e.target.value)}
        placeholder="Lote (si lo dejas vacío se usa General)"
        style={input}
      />
      <input
        type="number"
        min={1}
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        placeholder={`Cantidad de ${unidad}s`}
        style={input}
      />
      <label style={{ fontSize: 13, fontWeight: 600 }}>Fecha</label>
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
      <button type="button" onClick={registrar} disabled={busy} style={{ padding: '12px 24px' }}>
        {busy ? 'Registrando…' : 'Registrar recepción'}
      </button>
    </div>
  );
}
