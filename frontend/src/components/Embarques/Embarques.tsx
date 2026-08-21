import { useState, type CSSProperties } from 'react';
import type { Cliente, EmbarqueDetalle, InventarioFinalItem } from '../../types';
import { InventarioFinalSelector } from '../ui';
import { useCreateEmbarque } from '../../hooks/useCreateEmbarque';
import { useCreateCliente } from '../../hooks/useClientes';
import {
  parseManifiesto,
  confirmarManifiesto,
  type ManifiestoParseResult,
} from '../../lib/api';

interface EmbarquesProps {
  token: string;
  inventarioFinal: InventarioFinalItem[];
  onEmbarqueRegistered: () => void;
  clientes: Cliente[];
  cargarClientes: () => Promise<void>;
}

export default function Embarques({
  token,
  inventarioFinal,
  onEmbarqueRegistered,
  clientes,
  cargarClientes: _cargarClientes,
}: EmbarquesProps) {
  const [clienteIdEmbarque, setClienteIdEmbarque] = useState('');
  const [detallesEmbarque, setDetallesEmbarque] = useState<EmbarqueDetalle[]>([]);

  // Formulario rápido para crear cliente
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientNombre, setNewClientNombre] = useState('');
  const [newClientEmpresa, setNewClientEmpresa] = useState('');
  const [newClientContacto, setNewClientContacto] = useState('');

  const [selectedFinalStock, setSelectedFinalStock] = useState<InventarioFinalItem | null>(null);
  const [selectedCantidad, setSelectedCantidad] = useState('');

  // Manifiesto PDF
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [manifestPreview, setManifestPreview] = useState<ManifiestoParseResult | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState('');
  const [manifestConfirming, setManifestConfirming] = useState(false);

  const createClienteMutation = useCreateCliente(token);

  const crearClienteRapido = async () => {
    if (!newClientNombre.trim()) {
      return alert('El nombre del cliente es obligatorio');
    }

    try {
      const nuevoCliente = await createClienteMutation.mutateAsync({
        nombre: newClientNombre.trim(),
        empresa: newClientEmpresa.trim() || null,
        contacto: newClientContacto.trim() || null,
      });

      alert('✅ Cliente creado correctamente');
      setClienteIdEmbarque(nuevoCliente.id.toString());

      setNewClientNombre('');
      setNewClientEmpresa('');
      setNewClientContacto('');
      setShowNewClientForm(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      alert('Error al crear cliente: ' + message);
    }
  };

  /** Misma clave de inventario (presentación/talla o uva variedad+cultivo+mercado). */
  const mismaLineaInventario = (
    a: {
      producto?: string | null;
      presentacion?: string | null;
      talla?: string | null;
      variedad?: string | null;
      tipo_cultivo?: string | null;
      mercado?: string | null;
    },
    b: {
      producto?: string | null;
      presentacion?: string | null;
      talla?: string | null;
      variedad?: string | null;
      tipo_cultivo?: string | null;
      mercado?: string | null;
    }
  ) => {
    const aLimon = a.producto === 'limon_amarillo' || !!a.presentacion;
    const bLimon = b.producto === 'limon_amarillo' || !!b.presentacion;
    if (aLimon !== bLimon) return false;
    if (aLimon) {
      return (
        (a.presentacion || null) === (b.presentacion || null) &&
        (a.talla || null) === (b.talla || null) &&
        (a.mercado || null) === (b.mercado || null)
      );
    }
    return (
      (a.variedad || null) === (b.variedad || null) &&
      (a.tipo_cultivo || null) === (b.tipo_cultivo || null) &&
      (a.mercado || null) === (b.mercado || null)
    );
  };

  /** Stock real menos lo ya cargado en las líneas del embarque actual. */
  const stockDisponiblePara = (item: InventarioFinalItem) => {
    const ya = detallesEmbarque
      .filter((d) =>
        mismaLineaInventario(
          {
            producto: item.producto,
            presentacion: item.presentacion,
            talla: item.talla,
            variedad: item.variedad,
            tipo_cultivo: item.tipo_cultivo,
            mercado: item.mercado,
          },
          d
        )
      )
      .reduce((s, d) => s + (d.cantidad_cajas || 0), 0);
    return Math.max(0, (item.cantidad_stock || 0) - ya);
  };

  const stockDisponibleSeleccionado = selectedFinalStock
    ? stockDisponiblePara(selectedFinalStock)
    : 0;

  const agregarLineaEmbarque = () => {
    if (!selectedFinalStock || !selectedCantidad) {
      return alert('Selecciona un producto del inventario final y una cantidad');
    }

    const cantidad = parseInt(selectedCantidad, 10);

    if (isNaN(cantidad) || cantidad <= 0) {
      return alert('La cantidad debe ser un número mayor a 0');
    }

    const disponible = stockDisponiblePara(selectedFinalStock);
    if (disponible <= 0) {
      return alert(
        'Ya agregaste todo el stock disponible de este producto en este embarque. ' +
          'Quita o reduce una línea si quieres reasignar.'
      );
    }
    if (cantidad > disponible) {
      return alert(
        `Solo quedan ${disponible} cajas disponibles de este producto en el embarque ` +
          `(stock ${selectedFinalStock.cantidad_stock}, ya agregadas ${selectedFinalStock.cantidad_stock - disponible}).`
      );
    }

    const isLimon =
      selectedFinalStock.producto === 'limon_amarillo' || !!selectedFinalStock.presentacion;

    const tallaStr =
      selectedFinalStock.talla != null && String(selectedFinalStock.talla).trim() !== ''
        ? String(selectedFinalStock.talla).trim()
        : null;

    const newDetalle: EmbarqueDetalle = {
      producto: isLimon ? 'limon_amarillo' : selectedFinalStock.producto || 'uva',
      variedad: isLimon ? undefined : selectedFinalStock.variedad,
      tipo_cultivo: isLimon ? undefined : selectedFinalStock.tipo_cultivo,
      mercado: selectedFinalStock.mercado,
      cantidad_cajas: cantidad,
      presentacion: selectedFinalStock.presentacion || null,
      talla: isLimon ? tallaStr : null,
      calidad: selectedFinalStock.calidad || null,
    };

    setDetallesEmbarque([...detallesEmbarque, newDetalle]);

    setSelectedFinalStock(null);
    setSelectedCantidad('');
  };

  const eliminarLineaEmbarque = (index: number) => {
    setDetallesEmbarque(detallesEmbarque.filter((_, i) => i !== index));
  };

  const createEmbarqueMutation = useCreateEmbarque(token);

  const registrarEmbarque = async () => {
    if (!clienteIdEmbarque || detallesEmbarque.length === 0) {
      return alert('Debe seleccionar un cliente y al menos un producto');
    }
    try {
      await createEmbarqueMutation.mutateAsync({
        cliente_id: parseInt(clienteIdEmbarque),
        notas: null,
        detalles: detallesEmbarque,
      });
      alert('✅ Embarque registrado correctamente');
      setClienteIdEmbarque('');
      setDetallesEmbarque([]);
      onEmbarqueRegistered();
    } catch (err: any) {
      console.error('Full embarque error:', err);
      let message = 'Error desconocido';
      if (err.response?.data) {
        const data = err.response.data;
        message =
          data.detail ||
          data.message ||
          (Array.isArray(data) ? JSON.stringify(data) : JSON.stringify(data));
      } else if (err.request) {
        message =
          'No se pudo conectar con el servidor (posiblemente el backend está reiniciando o caído)';
      } else {
        message = err.message || String(err);
      }
      alert('Error: ' + message);
    }
  };

  const isSubmittingEmbarque = createEmbarqueMutation.isPending;

  const getPresentacionLabel = (presentacion?: string | null, talla?: string | null) => {
    if (!presentacion) return '';
    const map: Record<string, string> = {
      rpc_12: 'RPC 12',
      rpc_18: 'RPC 18',
      caja_40lbs: 'Caja 40 lbs',
      bins_jugo: 'Bins 900kg',
    };
    const base = map[presentacion] || presentacion;
    return talla ? `${base} #${talla}` : base;
  };

  const handleParseManifiesto = async () => {
    if (!manifestFile) return alert('Selecciona un PDF de manifiesto');
    setManifestLoading(true);
    setManifestError('');
    setManifestPreview(null);
    try {
      const data = await parseManifiesto(token, manifestFile);
      setManifestPreview(data);
      if (data.cliente_sugerido_id) {
        setClienteIdEmbarque(String(data.cliente_sugerido_id));
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setManifestError(
        typeof detail === 'string' ? detail : err?.message || 'Error al leer el PDF'
      );
    } finally {
      setManifestLoading(false);
    }
  };

  /** Recalcula totales / puede_confirmar tras editar o quitar líneas del preview. */
  const aplicarDetallesManifiesto = (
    detalles: ManifiestoParseResult['detalles']
  ) => {
    setManifestPreview((prev) => {
      if (!prev) return prev;
      const next = detalles.map((d) => ({
        ...d,
        cantidad_cajas: Math.max(0, Math.round(Number(d.cantidad_cajas) || 0)),
        suficiente:
          Math.max(0, Math.round(Number(d.cantidad_cajas) || 0)) <=
          (d.stock_disponible || 0),
      }));
      const total = next.reduce((s, d) => s + (d.cantidad_cajas || 0), 0);
      return {
        ...prev,
        detalles: next,
        total_bultos_parseados: total,
        puede_confirmar: next.length > 0 && next.every((d) => d.suficiente),
      };
    });
  };

  /** Elimina por completo un producto (línea) del resumen del manifiesto. */
  const quitarProductoManifiesto = (index: number) => {
    if (!manifestPreview) return;
    const d = manifestPreview.detalles[index];
    if (!d) return;
    const label = getPresentacionLabel(d.presentacion, d.talla) || 'producto';
    if (
      !confirm(
        `¿Quitar del embarque "${label}" (${d.cantidad_cajas} cajas)?\n` +
          `No se descontará del inventario hasta confirmar.`
      )
    ) {
      return;
    }
    aplicarDetallesManifiesto(manifestPreview.detalles.filter((_, i) => i !== index));
  };

  /** Ajuste parcial: cambia la cantidad de un producto (0 = quitar). */
  const ajustarCantidadManifiesto = (index: number, raw: string) => {
    if (!manifestPreview) return;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return;
    if (n === 0) {
      aplicarDetallesManifiesto(manifestPreview.detalles.filter((_, i) => i !== index));
      return;
    }
    aplicarDetallesManifiesto(
      manifestPreview.detalles.map((d, i) =>
        i === index ? { ...d, cantidad_cajas: n } : d
      )
    );
  };

  /** Quita de golpe todas las líneas con stock insuficiente. */
  const quitarSinStockManifiesto = () => {
    if (!manifestPreview) return;
    const conFalta = manifestPreview.detalles.filter((d) => !d.suficiente);
    if (conFalta.length === 0) return alert('No hay líneas con falta de stock');
    if (
      !confirm(
        `¿Quitar ${conFalta.length} producto(s) sin stock suficiente del resumen?`
      )
    ) {
      return;
    }
    aplicarDetallesManifiesto(manifestPreview.detalles.filter((d) => d.suficiente));
  };

  const handleConfirmarManifiesto = async () => {
    if (!manifestPreview) return;
    if (!clienteIdEmbarque) {
      return alert('Selecciona o crea el cliente (consignatario) antes de confirmar');
    }
    if (!manifestPreview.detalles.length) {
      return alert('No hay líneas de producto en el manifiesto');
    }
    if (!manifestPreview.puede_confirmar) {
      if (
        !confirm(
          'Hay productos sin stock suficiente. ¿Intentar de todos modos? (fallará si falta stock)'
        )
      ) {
        return;
      }
    } else if (
      !confirm(
        `¿Confirmar embarque y descontar del inventario?\n\n` +
          `${manifestPreview.total_bultos_parseados} bultos · ` +
          `${manifestPreview.detalles.length} presentaciones\n` +
          `Cliente ID: ${clienteIdEmbarque}`
      )
    ) {
      return;
    }

    setManifestConfirming(true);
    try {
      const detalles = manifestPreview.detalles
        .filter((d) => (d.cantidad_cajas || 0) > 0)
        .map((d) => ({
          producto: 'limon_amarillo' as const,
          mercado: (d.mercado === 'nacional' ? 'nacional' : 'exportacion') as
            | 'nacional'
            | 'exportacion',
          cantidad_cajas: d.cantidad_cajas,
          presentacion: d.presentacion || undefined,
          talla: d.talla || undefined,
          calidad: d.calidad || undefined,
          cajas_por_parrilla: d.cajas_por_parrilla ?? undefined,
        }));
      if (!detalles.length) {
        return alert('No hay productos con cantidad > 0 para confirmar');
      }

      const notas = [
        manifestPreview.numero_manifiesto
          ? `Manifiesto N° ${manifestPreview.numero_manifiesto}`
          : null,
        manifestPreview.factura ? `Factura ${manifestPreview.factura}` : null,
        manifestPreview.distribuidor || null,
        manifestFile?.name || null,
      ]
        .filter(Boolean)
        .join(' · ');

      await confirmarManifiesto(token, {
        cliente_id: parseInt(clienteIdEmbarque, 10),
        notas,
        fecha_embarque: manifestPreview.fecha_embarque || null,
        detalles,
      });

      alert('✅ Embarque desde manifiesto registrado. Inventario descontado.');
      setManifestFile(null);
      setManifestPreview(null);
      setClienteIdEmbarque('');
      onEmbarqueRegistered();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      alert(
        'Error: ' +
          (typeof detail === 'string' ? detail : err?.message || 'No se pudo confirmar')
      );
    } finally {
      setManifestConfirming(false);
    }
  };

  return (
    <div style={{ background: 'white', padding: '25px', borderRadius: '10px' }}>
      <h2>🚢 Embarques</h2>

      {/* ===== Manifiesto PDF ===== */}
      <div
        style={{
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: 12,
          padding: 20,
          marginBottom: 28,
        }}
      >
        <h3 style={{ marginTop: 0, color: '#0c4a6e' }}>📄 Cargar manifiesto (PDF)</h3>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
          Sube el manifiesto de exportación (formato Llano Brand). Se leen las líneas, se agrupan
          por presentación/talla y al confirmar se descuenta el inventario final automáticamente.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setManifestFile(e.target.files?.[0] || null);
              setManifestPreview(null);
              setManifestError('');
            }}
          />
          <button
            type="button"
            onClick={handleParseManifiesto}
            disabled={!manifestFile || manifestLoading}
            style={{
              padding: '10px 18px',
              background: !manifestFile || manifestLoading ? '#94a3b8' : '#0369a1',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: !manifestFile || manifestLoading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {manifestLoading ? 'Leyendo PDF…' : 'Leer manifiesto'}
          </button>
        </div>

        {manifestError && (
          <p style={{ color: '#dc2626', marginTop: 12 }}>{manifestError}</p>
        )}

        {manifestPreview && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 10,
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              <div>
                <strong>Fecha:</strong> {manifestPreview.fecha_embarque || '—'}
              </div>
              <div>
                <strong>Distribuidor:</strong> {manifestPreview.distribuidor || '—'}
              </div>
              <div>
                <strong>Lugar:</strong> {manifestPreview.lugar || '—'}
              </div>
              <div>
                <strong>Factura:</strong> {manifestPreview.factura || '—'}
              </div>
              <div>
                <strong>Bultos:</strong> {manifestPreview.total_bultos_parseados}
                {manifestPreview.total_bultos_manifiesto != null &&
                  ` / ${manifestPreview.total_bultos_manifiesto}`}
              </div>
              <div>
                <strong>Mercado:</strong> {manifestPreview.mercado || '—'}
              </div>
            </div>

            {manifestPreview.warnings?.length > 0 && (
              <div
                style={{
                  background: '#fef9c3',
                  padding: 10,
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                {manifestPreview.warnings.map((w, i) => (
                  <div key={i}>⚠️ {w}</div>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h4 style={{ margin: 0 }}>Resumen a descontar del inventario</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {manifestPreview.detalles.some((d) => !d.suficiente) && (
                  <button
                    type="button"
                    onClick={quitarSinStockManifiesto}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      background: '#fff7ed',
                      color: '#9a3412',
                      border: '1px solid #fdba74',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Quitar sin stock
                  </button>
                )}
                {manifestPreview.detalles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          '¿Vaciar todo el resumen del manifiesto?\nPuedes volver a leer el PDF.'
                        )
                      ) {
                        aplicarDetallesManifiesto([]);
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      background: '#fef2f2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Vaciar resumen
                  </button>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 0, marginBottom: 10 }}>
              Si el PDF malinterpretó un producto, <strong>ajusta la cantidad</strong> (parcial) o{' '}
              <strong>quítarlo</strong> antes de confirmar. Así no se bloquea el registro.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#e0f2fe', textAlign: 'left' }}>
                    <th style={th}>Presentación</th>
                    <th style={th}>Cantidad</th>
                    <th style={th}>Stock actual</th>
                    <th style={th}>Estado</th>
                    <th style={th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {manifestPreview.detalles.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...td, color: '#64748b' }}>
                        No quedan productos en el resumen. Vuelve a leer el PDF o agrega
                        productos en el embarque manual.
                      </td>
                    </tr>
                  ) : (
                    manifestPreview.detalles.map((d, i) => (
                      <tr
                        key={`${d.presentacion}-${d.talla}-${i}`}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: d.suficiente ? undefined : '#fef2f2',
                        }}
                      >
                        <td style={td}>
                          {getPresentacionLabel(d.presentacion, d.talla)}
                          <div style={{ fontSize: 11, color: '#64748b' }}>{d.calidad}</div>
                        </td>
                        <td style={td}>
                          <input
                            type="number"
                            min={0}
                            max={Math.max(d.cantidad_cajas, d.stock_disponible || 0) * 2 || undefined}
                            value={d.cantidad_cajas}
                            onChange={(e) => ajustarCantidadManifiesto(i, e.target.value)}
                            title="Cantidad parcial a embarcar (0 = quitar)"
                            style={{
                              width: 88,
                              padding: '6px 8px',
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              fontWeight: 700,
                            }}
                          />
                        </td>
                        <td style={td}>{d.stock_disponible}</td>
                        <td style={td}>
                          {d.suficiente ? (
                            <span style={{ color: '#15803d', fontWeight: 600 }}>OK</span>
                          ) : (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>
                              Falta stock ({d.cantidad_cajas - d.stock_disponible})
                            </span>
                          )}
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {!d.suficiente && d.stock_disponible > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  ajustarCantidadManifiesto(i, String(d.stock_disponible))
                                }
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  background: '#ecfccb',
                                  color: '#3f6212',
                                  border: '1px solid #bef264',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                                title="Ajustar al stock disponible"
                              >
                                Usar {d.stock_disponible}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => quitarProductoManifiesto(i)}
                              style={{
                                padding: '4px 8px',
                                fontSize: 11,
                                background: '#fee2e2',
                                color: '#b91c1c',
                                border: '1px solid #fecaca',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              Quitar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <details style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
              <summary style={{ cursor: 'pointer' }}>
                Ver {manifestPreview.lineas_raw.length} líneas del PDF
              </summary>
              <ul style={{ maxHeight: 180, overflow: 'auto' }}>
                {manifestPreview.lineas_raw.map((ln) => (
                  <li key={ln.no}>
                    #{ln.no} · {ln.bultos} bultos · {ln.descripcion.slice(0, 70)}
                    {ln.lote ? ` · lote ${ln.lote}` : ''}
                    {!ln.parse_ok && ln.parse_note ? ` ⚠ ${ln.parse_note}` : ''}
                  </li>
                ))}
              </ul>
            </details>

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Cliente / consignatario *
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <select
                  value={clienteIdEmbarque}
                  onChange={(e) => setClienteIdEmbarque(e.target.value)}
                  style={{ flex: 1, minWidth: 220, padding: 10 }}
                >
                  <option value="">Seleccionar Cliente *</option>
                  {clientes.map((c: Cliente) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.empresa ? `(${c.empresa})` : ''}
                    </option>
                  ))}
                </select>
                {manifestPreview.cliente_sugerido_nombre && (
                  <span style={{ fontSize: 12, color: '#0369a1', alignSelf: 'center' }}>
                    Sugerido: {manifestPreview.cliente_sugerido_nombre}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleConfirmarManifiesto}
              disabled={
                manifestConfirming ||
                !clienteIdEmbarque ||
                manifestPreview.detalles.length === 0
              }
              style={{
                marginTop: 16,
                width: '100%',
                padding: '14px 20px',
                background:
                  manifestConfirming ||
                  !clienteIdEmbarque ||
                  manifestPreview.detalles.length === 0
                    ? '#94a3b8'
                    : manifestPreview.puede_confirmar
                      ? '#15803d'
                      : '#b45309',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 15,
                cursor:
                  manifestConfirming ||
                  !clienteIdEmbarque ||
                  manifestPreview.detalles.length === 0
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              {manifestConfirming
                ? 'Registrando y descontando…'
                : manifestPreview.detalles.length === 0
                  ? 'Sin productos para confirmar'
                  : manifestPreview.puede_confirmar
                    ? `Confirmar embarque (${manifestPreview.total_bultos_parseados} bultos)`
                    : 'Confirmar (hay faltantes de stock)'}
            </button>
          </div>
        )}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '24px 0' }} />

      <h3 style={{ marginTop: 0 }}>Embarque manual</h3>

      {/* Cliente */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <select
          value={clienteIdEmbarque}
          onChange={(e) => setClienteIdEmbarque(e.target.value)}
          style={{ flex: 1, padding: '12px' }}
        >
          <option value="">Seleccionar Cliente *</option>
          {clientes.map((c: Cliente) => (
            <option key={c.id} value={c.id}>
              {c.nombre} {c.empresa ? `(${c.empresa})` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowNewClientForm(!showNewClientForm)}
          style={{
            padding: '12px 16px',
            background: '#166534',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          + Nuevo
        </button>
      </div>

      {showNewClientForm && (
        <div
          style={{
            background: '#f8fafc',
            padding: '15px',
            borderRadius: '8px',
            marginTop: '8px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '10px', color: '#166534' }}>
            Crear nuevo cliente
          </div>
          <input
            type="text"
            placeholder="Nombre del cliente *"
            value={newClientNombre}
            onChange={(e) => setNewClientNombre(e.target.value)}
            style={{ width: '100%', padding: '10px', marginBottom: '8px' }}
          />
          <input
            type="text"
            placeholder="Empresa (opcional)"
            value={newClientEmpresa}
            onChange={(e) => setNewClientEmpresa(e.target.value)}
            style={{ width: '100%', padding: '10px', marginBottom: '8px' }}
          />
          <input
            type="text"
            placeholder="Contacto (opcional)"
            value={newClientContacto}
            onChange={(e) => setNewClientContacto(e.target.value)}
            style={{ width: '100%', padding: '10px', marginBottom: '12px' }}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={crearClienteRapido}
              disabled={createClienteMutation.isPending || !newClientNombre.trim()}
              style={{
                flex: 1,
                padding: '10px',
                background: '#166534',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
              }}
            >
              {createClienteMutation.isPending ? 'Guardando...' : 'Guardar Cliente'}
            </button>
            <button
              onClick={() => {
                setShowNewClientForm(false);
                setNewClientNombre('');
                setNewClientEmpresa('');
                setNewClientContacto('');
              }}
              style={{
                flex: 1,
                padding: '10px',
                background: '#64748b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <h3>Agregar productos al embarque (desde Inventario Final)</h3>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap', alignItems: 'center' }}>
        <InventarioFinalSelector
          inventario={inventarioFinal}
          value={selectedFinalStock}
          onChange={(item) => {
            setSelectedFinalStock(item);
            setSelectedCantidad('');
          }}
          style={{ padding: '10px', flex: 2, minWidth: '320px' }}
        />

        <input
          type="number"
          placeholder="Cantidad"
          min={1}
          max={stockDisponibleSeleccionado || undefined}
          value={selectedCantidad}
          onChange={(e) => setSelectedCantidad(e.target.value)}
          style={{ padding: '10px', width: '120px' }}
          disabled={!selectedFinalStock || stockDisponibleSeleccionado <= 0}
        />

        <button
          type="button"
          onClick={agregarLineaEmbarque}
          disabled={
            !selectedFinalStock ||
            !selectedCantidad ||
            stockDisponibleSeleccionado <= 0
          }
          style={{
            padding: '10px 20px',
            opacity:
              !selectedFinalStock ||
              !selectedCantidad ||
              stockDisponibleSeleccionado <= 0
                ? 0.6
                : 1,
          }}
        >
          Agregar Línea
        </button>
      </div>
      {selectedFinalStock && (
        <p style={{ fontSize: 13, color: '#64748b', margin: '-8px 0 12px' }}>
          Disponible para este embarque:{' '}
          <strong style={{ color: stockDisponibleSeleccionado > 0 ? '#15803d' : '#b91c1c' }}>
            {stockDisponibleSeleccionado}
          </strong>
          {' / '}
          stock total {selectedFinalStock.cantidad_stock}
          {stockDisponibleSeleccionado < (selectedFinalStock.cantidad_stock || 0) && (
            <span>
              {' '}
              (ya en líneas:{' '}
              {(selectedFinalStock.cantidad_stock || 0) - stockDisponibleSeleccionado})
            </span>
          )}
          {stockDisponibleSeleccionado <= 0 && (
            <span style={{ color: '#b91c1c' }}>
              {' '}
              — ya usaste todo este producto en las líneas de abajo
            </span>
          )}
        </p>
      )}

      <h4>Productos en este embarque:</h4>

      {detallesEmbarque.length > 0 ? (
        <>
          {detallesEmbarque.map((det, index) => {
            const isLimon = !!det.presentacion;
            const isExport = !isLimon && det.mercado === 'exportacion';
            return (
              <div
                key={index}
                style={{
                  padding: '12px 14px',
                  background: isLimon ? '#fefce8' : isExport ? '#dbeafe' : '#dcfce7',
                  margin: '6px 0',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderLeft: isLimon
                    ? '5px solid #ca8a04'
                    : isExport
                      ? '5px solid #3b82f6'
                      : '5px solid #22c55e',
                }}
              >
                <div>
                  <strong>
                    {det.presentacion
                      ? getPresentacionLabel(det.presentacion, det.talla)
                      : det.variedad
                        ? `${det.variedad} ${det.tipo_cultivo || ''}`.trim()
                        : det.producto}
                  </strong>
                  {!det.presentacion && (
                    <span
                      style={{
                        marginLeft: '6px',
                        color: isExport ? '#1e40af' : '#166534',
                      }}
                    >
                      ({det.mercado})
                    </span>
                  )}
                  <br />
                  <span style={{ fontSize: '15px' }}>
                    <strong>{det.cantidad_cajas}</strong> {det.presentacion ? '' : 'cajas'}
                  </span>
                </div>
                <button
                  onClick={() => eliminarLineaEmbarque(index)}
                  style={{
                    color: '#dc2626',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px',
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}

          {(() => {
            const totalCajas = detallesEmbarque.reduce(
              (sum, d) => sum + (d.cantidad_cajas || 0),
              0
            );
            return (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  background: '#f1f5f9',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <strong>Total a embarcar:</strong> {totalCajas} cajas
              </div>
            );
          })()}
        </>
      ) : (
        <p style={{ color: '#666', fontStyle: 'italic' }}>
          Aún no has agregado productos al embarque.
        </p>
      )}

      <button
        onClick={registrarEmbarque}
        disabled={!clienteIdEmbarque || detallesEmbarque.length === 0 || isSubmittingEmbarque}
        style={{
          padding: '14px 40px',
          marginTop: '20px',
          background:
            !clienteIdEmbarque || detallesEmbarque.length === 0 || isSubmittingEmbarque
              ? '#64748b'
              : '#1e40af',
          color: 'white',
          width: '100%',
          cursor:
            !clienteIdEmbarque || detallesEmbarque.length === 0 || isSubmittingEmbarque
              ? 'not-allowed'
              : 'pointer',
          opacity: isSubmittingEmbarque ? 0.7 : 1,
        }}
      >
        {isSubmittingEmbarque ? 'Registrando...' : 'Confirmar y Registrar Embarque'}
      </button>
      {(!clienteIdEmbarque || detallesEmbarque.length === 0) && (
        <p
          style={{
            color: '#64748b',
            fontSize: '12px',
            textAlign: 'center',
            marginTop: '6px',
          }}
        >
          Selecciona un cliente y agrega al menos un producto
        </p>
      )}
    </div>
  );
}

const th: CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
};

const td: CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'top',
};
