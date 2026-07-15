import { useState } from 'react';
import type { Cliente, EmbarqueDetalle, InventarioFinalItem } from '../../types';
import { InventarioFinalSelector } from '../ui';
import { useCreateEmbarque } from '../../hooks/useCreateEmbarque';
import { useCreateCliente } from '../../hooks/useClientes';

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

  const createClienteMutation = useCreateCliente(token);

  const crearClienteRapido = async () => {
    if (!newClientNombre.trim()) {
      return alert("El nombre del cliente es obligatorio");
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

  const agregarLineaEmbarque = () => {
    if (!selectedFinalStock || !selectedCantidad) {
      return alert("Selecciona un producto del inventario final y una cantidad");
    }

    const cantidad = parseInt(selectedCantidad);

    if (isNaN(cantidad) || cantidad <= 0) {
      return alert("La cantidad debe ser un número mayor a 0");
    }

    if (cantidad > selectedFinalStock.cantidad_stock) {
      return alert(`No puedes agregar más de ${selectedFinalStock.cantidad_stock} cajas disponibles`);
    }

    const isLimon = selectedFinalStock.producto === 'limon_amarillo' || !!selectedFinalStock.presentacion;

    const newDetalle: any = {
      producto: isLimon ? 'limon_amarillo' : (selectedFinalStock.producto || 'uva'),
      variedad: isLimon ? undefined : selectedFinalStock.variedad,
      tipo_cultivo: isLimon ? undefined : selectedFinalStock.tipo_cultivo,
      mercado: selectedFinalStock.mercado,
      cantidad_cajas: cantidad,
      presentacion: selectedFinalStock.presentacion,
      talla: selectedFinalStock.talla,
      calidad: selectedFinalStock.calidad
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
      return alert("Debe seleccionar un cliente y al menos un producto");
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
        message = data.detail || data.message || (Array.isArray(data) ? JSON.stringify(data) : JSON.stringify(data));
      } else if (err.request) {
        message = 'No se pudo conectar con el servidor (posiblemente el backend está reiniciando o caído)';
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
      'rpc_12': 'RPC 12',
      'rpc_18': 'RPC 18',
      'caja_40lbs': 'Caja 40 lbs',
      'bins_jugo': 'Bins 900kg'
    };
    const base = map[presentacion] || presentacion;
    return talla ? `${base} #${talla}` : base;
  };

  return (
    <div style={{background: 'white', padding: '25px', borderRadius: '10px'}}>
      <h2>🚢 Nuevo Embarque</h2>

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
          style={{ padding: '12px 16px', background: '#166534', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          + Nuevo
        </button>
      </div>

      {showNewClientForm && (
        <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', marginTop: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 600, marginBottom: '10px', color: '#166534' }}>Crear nuevo cliente</div>
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
              style={{ flex: 1, padding: '10px', background: '#166534', color: 'white', border: 'none', borderRadius: '6px' }}
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
              style={{ flex: 1, padding: '10px', background: '#64748b', color: 'white', border: 'none', borderRadius: '6px' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <h3>Agregar productos al embarque (desde Inventario Final)</h3>
      <div style={{display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap'}}>
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
          value={selectedCantidad} 
          onChange={(e) => setSelectedCantidad(e.target.value)} 
          style={{padding: '10px', width: '120px'}} 
          disabled={!selectedFinalStock}
        />

        <button 
          onClick={agregarLineaEmbarque} 
          disabled={!selectedFinalStock || !selectedCantidad}
          style={{padding: '10px 20px', opacity: (!selectedFinalStock || !selectedCantidad) ? 0.6 : 1}}
        >
          Agregar Línea
        </button>
      </div>

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
                  background: isLimon ? '#fefce8' : (isExport ? '#dbeafe' : '#dcfce7'), 
                  margin: '6px 0', 
                  borderRadius: '6px', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  borderLeft: isLimon ? '5px solid #ca8a04' : (isExport ? '5px solid #3b82f6' : '5px solid #22c55e')
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
                    <span style={{marginLeft: '6px', color: isExport ? '#1e40af' : '#166534'}}>
                      ({det.mercado})
                    </span>
                  )}
                  <br />
                  <span style={{fontSize: '15px'}}><strong>{det.cantidad_cajas}</strong> {det.presentacion ? '' : 'cajas'}</span>
                </div>
                <button 
                  onClick={() => eliminarLineaEmbarque(index)} 
                  style={{color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px'}}
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* Resumen de totales */}
          {(() => {
            const totalCajas = detallesEmbarque.reduce((sum, d) => sum + (d.cantidad_cajas || 0), 0);
            return (
              <div style={{marginTop: '12px', padding: '10px 14px', background: '#f1f5f9', borderRadius: '6px', fontSize: '14px'}}>
                <strong>Total a embarcar:</strong> {totalCajas} cajas
              </div>
            );
          })()}
        </>
      ) : (
        <p style={{color: '#666', fontStyle: 'italic'}}>Aún no has agregado productos al embarque.</p>
      )}

      <button 
        onClick={registrarEmbarque} 
        disabled={!clienteIdEmbarque || detallesEmbarque.length === 0 || isSubmittingEmbarque}
        style={{ 
          padding: '14px 40px', 
          marginTop: '20px', 
          background: (!clienteIdEmbarque || detallesEmbarque.length === 0 || isSubmittingEmbarque) ? '#64748b' : '#1e40af', 
          color: 'white', 
          width: '100%',
          cursor: (!clienteIdEmbarque || detallesEmbarque.length === 0 || isSubmittingEmbarque) ? 'not-allowed' : 'pointer',
          opacity: isSubmittingEmbarque ? 0.7 : 1
        }}
      >
        {isSubmittingEmbarque ? 'Registrando...' : 'Confirmar y Registrar Embarque'}
      </button>
      {(!clienteIdEmbarque || detallesEmbarque.length === 0) && (
        <p style={{color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '6px'}}>
          Selecciona un cliente y agrega al menos un producto
        </p>
      )}
    </div>
  );
}
