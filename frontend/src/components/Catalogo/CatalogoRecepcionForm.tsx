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
  const [forma, setForma] = useState('');
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
  const formas = producto.formas?.length
    ? producto.formas
    : producto.peso_contenedor_kg
      ? [{ codigo: producto.tipo_cosecha, nombre: producto.tipo_cosecha_nombre, peso_kg: producto.peso_contenedor_kg }]
      : [];
  const formaSel = formas.find((f) => f.codigo === forma) || (formas.length === 1 ? formas[0] : undefined);
  if (!producto.configurado) {
    return (
      <p style={{ color: '#92400e' }}>
        {producto.nombre} todavía no tiene peso ni tipos de caja. Termina la configuración en Ajustes
        generales.
      </p>
    );
  }

  const unidad = (formaSel?.nombre || 'contenedor').toLowerCase();
  const nPreview = parseInt(cantidad, 10);
  const kgPreview =
    formaSel && Number.isInteger(nPreview) && nPreview > 0 ? nPreview * formaSel.peso_kg : null;

  const registrar = async () => {
    if (!formaSel) return alert('Elige la forma de cosecha');
    const n = parseInt(cantidad, 10);
    if (!Number.isInteger(n) || n <= 0) return alert(`Indica cuántos ${unidad}s entran`);
    setBusy(true);
    try {
      await crearRecepcionCatalogo(token, {
        producto_id: producto.id,
        cantidad: n,
        lote: lote.trim() || 'General',
        fecha: fecha || null,
        codigo_cosecha: formaSel.codigo,
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
        {producto.nombre}. Los kilos de campo son la cantidad por el peso de la forma elegida.
      </p>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Forma de cosecha</label>
      <select value={formaSel?.codigo || ''} onChange={(e) => setForma(e.target.value)} style={input}>
        {formas.length !== 1 && <option value="">Elegir forma</option>}
        {formas.map((f) => (
          <option key={f.codigo} value={f.codigo}>
            {f.nombre} · {f.peso_kg} kg
          </option>
        ))}
      </select>
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
      {kgPreview != null && (
        <p style={{ fontSize: 13, color: '#166534', marginTop: 0 }}>
          {nPreview} × {formaSel?.peso_kg} kg = <strong>{kgPreview.toLocaleString('en-US')} kg</strong> de campo
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
