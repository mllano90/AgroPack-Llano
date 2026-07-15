import { useState, useEffect } from 'react';
import type { TipoMercado, InventarioCampoItem, Variedad, TipoCultivo, Producto } from '../../types';
import { TipoCultivoSelect, InventarioCampoSelector } from '../ui';
import { useCreateEmpaque } from '../../hooks/useCreateEmpaque';
import { getApiBaseUrl } from '../../lib/api';

interface EmpaqueProps {
  token: string;
  inventarioCampo: InventarioCampoItem[];
  onEmpaqueRegistered: () => void;
}

export default function Empaque({ token, inventarioCampo, onEmpaqueRegistered }: EmpaqueProps) {
  const [productoEmpaque, setProductoEmpaque] = useState<Producto | ''>('');
  const [variedadEmpaque, setVariedadEmpaque] = useState<Variedad | ''>('');
  const [cajasCampoUsadas, setCajasCampoUsadas] = useState('');
  const [cajasCartonProducidas, setCajasCartonProducidas] = useState('');
  const [tipoCultivoEmpaque, setTipoCultivoEmpaque] = useState<TipoCultivo | ''>('');
  const [mercadoEmpaque, setMercadoEmpaque] = useState<TipoMercado>('nacional');
  
  // Para Limón: lista de desverdizado y consumos seleccionados
  const [desverdizadoList, setDesverdizadoList] = useState<any[]>([]);
  const [selectedLote, setSelectedLote] = useState('');
  const [selectedBinsToUse, setSelectedBinsToUse] = useState('');
  const [consumosDesverdizado, setConsumosDesverdizado] = useState<any[]>([]);  // [{lote, bins}]

  // Talla para presentaciones de 1ra (RPCs y caja)
  const tallasLimon = ['75', '95', '115', '140', '165', '200', '235'];

  // Producción estructurada (estilo embarques: seleccionar pres + talla + cant + agregar línea)
  const presentacionesLimon = [
    { value: 'rpc_12', label: 'RPC 12 bolsas 2lbs' },
    { value: 'rpc_18', label: 'RPC 18 bolsas 2lbs' },
    { value: 'caja_40lbs', label: 'Caja 40 lbs granel' },
    { value: 'bins_jugo', label: 'Bins 900kg (2da)' },
  ];
  const [prodPresentacion, setProdPresentacion] = useState('');
  const [prodTalla, setProdTalla] = useState('');
  const [prodCantidad, setProdCantidad] = useState('');
  const [lineasProduccion, setLineasProduccion] = useState<any[]>([]);

  const createEmpaqueMutation = useCreateEmpaque(token);

  const formatFechaCorta = (fecha: string) => {
    if (!fecha) return '';
    const date = new Date(fecha);
    if (isNaN(date.getTime())) return fecha;
    const meses = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    const d = String(date.getDate()).padStart(2, '0');
    const mes = meses[date.getMonth()];
    const y = date.getFullYear();
    return `${d} ${mes} ${y}`;
  };

  // Cargar lista de desverdizado para Limón
  useEffect(() => {
    if (productoEmpaque === 'limon_amarillo' && token) {
      const base = getApiBaseUrl();
      fetch(`${base}/api/recepcion/desverdizado`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(setDesverdizadoList)
        .catch(() => setDesverdizadoList([]));
    }
  }, [productoEmpaque, token]);

  const registrarEmpaque = async () => {
    if (!productoEmpaque) return alert("Selecciona un producto");

    try {
      const payload: any = {
        producto: productoEmpaque,
        mercado: mercadoEmpaque,
        porcentaje_merma: 0,
        notas_merma: "",
        numero_empacador: "EMP-01"
      };

      if (productoEmpaque === 'uva') {
        if (!variedadEmpaque || !cajasCampoUsadas || !cajasCartonProducidas || !tipoCultivoEmpaque) {
          return alert("Completa todos los campos para Uva");
        }
        payload.variedad = variedadEmpaque;
        payload.cantidad_cajas_campo_usadas = parseInt(cajasCampoUsadas);
        payload.tipo_cultivo = tipoCultivoEmpaque;
        payload.cantidad_cajas_carton_producidas = parseInt(cajasCartonProducidas);
        payload.porcentaje_merma = parseFloat(((parseInt(cajasCampoUsadas) - parseInt(cajasCartonProducidas)) / parseInt(cajasCampoUsadas) * 100).toFixed(2));
      } else {
        if (consumosDesverdizado.length === 0) {
          return alert("Agrega al menos un consumo de desverdizado");
        }
        if (lineasProduccion.length === 0) {
          return alert("Agrega al menos una línea de producción");
        }
        payload.consumos_desverdizado = consumosDesverdizado;
        payload.produccion = lineasProduccion;
        payload.cantidad_cajas_campo_usadas = 0;
        payload.cantidad_cajas_carton_producidas = 0;
      }

      await createEmpaqueMutation.mutateAsync(payload);
      alert('✅ Empaque registrado');
      // reset
      setCajasCampoUsadas(''); setCajasCartonProducidas(''); setVariedadEmpaque(''); setMercadoEmpaque('nacional');
      setConsumosDesverdizado([]); setSelectedLote(''); setSelectedBinsToUse('');
      setLineasProduccion([]);
      setProdPresentacion(''); setProdTalla(''); setProdCantidad('');
      onEmpaqueRegistered();
      // refresh desverdizado list so user sees updated bins
      const base = getApiBaseUrl();
      fetch(`${base}/api/recepcion/desverdizado`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(setDesverdizadoList).catch(() => {});
    } catch (err: any) {
      console.error('Full empaque error:', err);
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

  const agregarLineaProduccion = () => {
    if (!prodPresentacion || !prodCantidad) {
      return alert("Selecciona presentación y cantidad");
    }
    const cant = parseInt(prodCantidad);
    if (isNaN(cant) || cant <= 0) return alert("Cantidad inválida");
    if (prodPresentacion !== 'bins_jugo' && !prodTalla) {
      return alert("Selecciona el tamaño (talla) para presentaciones de 1ra");
    }
    const nueva = {
      presentacion: prodPresentacion,
      talla: prodPresentacion === 'bins_jugo' ? null : prodTalla,
      cantidad: cant
    };
    setLineasProduccion([...lineasProduccion, nueva]);
    setProdCantidad('');
  };

  const eliminarLineaProduccion = (idx: number) => {
    setLineasProduccion(lineasProduccion.filter((_, i) => i !== idx));
  };

  const isSubmitting = createEmpaqueMutation.isPending;

  return (
    <div style={{background: 'white', padding: '25px', borderRadius: '10px'}}>
      <h2>Empaque - Transformación</h2>

      <select value={productoEmpaque} onChange={e => {
        const val = e.target.value as Producto | '';
        setProductoEmpaque(val);
        // Limpiar para que empiece en blanco / seleccionar producto
        setCajasCampoUsadas('');
        setCajasCartonProducidas('');
        setTipoCultivoEmpaque('');
        setConsumosDesverdizado([]);
        setSelectedLote('');
        setSelectedBinsToUse('');
        setLineasProduccion([]);
        setProdPresentacion('');
        setProdTalla('');
        setProdCantidad('');
      }} style={{width:'100%', padding:12, margin:'8px 0'}}>
        <option value="">Seleccionar producto</option>
        <option value="uva">Uva</option>
        <option value="limon_amarillo">Limón Amarillo</option>
      </select>

      {productoEmpaque === 'uva' && (
        <>
          {/* Selector de inventario de campo con mercado */}
          <InventarioCampoSelector
            inventario={inventarioCampo}
            value={
              variedadEmpaque && mercadoEmpaque
                ? inventarioCampo.find(
                    (i) => i.variedad === variedadEmpaque && i.mercado === mercadoEmpaque
                  ) || null
                : null
            }
            onChange={(item) => {
              if (item) {
                setVariedadEmpaque(item.variedad);
                setMercadoEmpaque(item.mercado);
              } else {
                setVariedadEmpaque('');
                setMercadoEmpaque('nacional');
              }
            }}
          />
        </>
      )}

      {productoEmpaque === 'uva' && (
        <>
          <input type="number" placeholder="Cajas de Campo a Usar" value={cajasCampoUsadas} onChange={e => setCajasCampoUsadas(e.target.value)} style={{width:'100%', padding:'12px', margin:'8px 0'}} />
          <input type="number" placeholder="Cajas de Cartón Producidas" value={cajasCartonProducidas} onChange={e => setCajasCartonProducidas(e.target.value)} style={{width:'100%', padding:'12px', margin:'8px 0'}} />
          <TipoCultivoSelect value={tipoCultivoEmpaque} onChange={setTipoCultivoEmpaque} />
        </>
      )}

      {productoEmpaque === 'limon_amarillo' && (
        <>
          {/* Lista de desverdizado disponible (múltiple) */}
          <div style={{margin: '8px 0'}}>
            <strong>Inventario Desverdizado (elige lotes y bins):</strong>
            {desverdizadoList.length === 0 && <div style={{color:'#666'}}>No hay lotes disponibles</div>}
            {desverdizadoList.map((d: any) => (
              <div key={d.id} style={{display:'flex', gap:8, alignItems:'center', margin:'4px 0', fontSize:13}}>
                <span>Lote: <strong>{d.lote}</strong> | Bins disp: {d.cantidad_bins_disponibles} | Tentativa: {formatFechaCorta(d.fecha_tentativa_salida)}</span>
                <button onClick={() => {
                  setSelectedLote(d.lote);
                }} style={{padding:'2px 8px', fontSize:12}}>Seleccionar</button>
              </div>
            ))}
          </div>

          {/* Agregar consumo */}
          {selectedLote && (
            <div style={{display:'flex', gap:8, margin:'4px 0'}}>
              <span>Lote: {selectedLote}</span>
              <input type="number" placeholder="Bins a usar" value={selectedBinsToUse} onChange={e => setSelectedBinsToUse(e.target.value)} style={{width:80}} />
              <button onClick={() => {
                const binsNum = parseInt(selectedBinsToUse) || 0;
                if (binsNum > 0) {
                  setConsumosDesverdizado([...consumosDesverdizado, {lote: selectedLote, bins: binsNum}]);
                  setSelectedBinsToUse('');
                  setSelectedLote('');
                }
              }}>Agregar</button>
            </div>
          )}

          {/* Consumos agregados */}
          {consumosDesverdizado.length > 0 && (
            <div style={{margin:'4px 0', fontSize:12}}>
              <strong>Consumos:</strong> {consumosDesverdizado.map((c,i) => (
                <span key={i} style={{marginRight:8}}>{c.lote}:{c.bins} <button onClick={() => setConsumosDesverdizado(consumosDesverdizado.filter((_,j)=>j!==i))}>x</button></span>
              ))}
            </div>
          )}

          {/* Producción estructurada (selecciona pres, talla, cantidad y agrega línea) */}
          <div style={{margin: '8px 0'}}>
            <strong>Producción (agrega líneas de presentaciones):</strong>
            <div style={{display:'flex', gap:8, margin:'4px 0', flexWrap:'wrap'}}>
              <select 
                value={prodPresentacion} 
                onChange={e => {
                  const val = e.target.value;
                  setProdPresentacion(val);
                  if (val === 'bins_jugo') setProdTalla('');
                }} 
                style={{padding:'6px', minWidth: '180px'}}
              >
                <option value="">Presentación *</option>
                {presentacionesLimon.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              {prodPresentacion && prodPresentacion !== 'bins_jugo' && (
                <select value={prodTalla} onChange={e=>setProdTalla(e.target.value)} style={{padding:'6px'}}>
                  <option value="">Talla *</option>
                  {tallasLimon.map(t => <option key={t} value={t}>Talla {t}</option>)}
                </select>
              )}

              <input 
                type="number" 
                placeholder="Cantidad *" 
                value={prodCantidad} 
                onChange={e=>setProdCantidad(e.target.value)} 
                style={{width:90, padding:'6px'}} 
              />

              <button onClick={agregarLineaProduccion} style={{padding:'6px 12px'}}>Agregar línea</button>
            </div>

            {lineasProduccion.length > 0 && (
              <div style={{margin:'4px 0', fontSize:12}}>
                <strong>Líneas agregadas:</strong>{' '}
                {lineasProduccion.map((l, i) => (
                  <span key={i} style={{marginRight:8, background:'#fefce8', padding:'2px 4px', borderRadius:3}}>
                    {l.presentacion}{l.talla ? ' T'+l.talla : ''} × {l.cantidad}{' '}
                    <button onClick={() => eliminarLineaProduccion(i)} style={{color:'red', background:'none', border:'none', cursor:'pointer'}}>x</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Mostrar el mercado seleccionado (heredado del inventario) */}
      <button 
        onClick={registrarEmpaque} 
        disabled={isSubmitting}
        style={{padding: '12px 30px', marginTop: '15px', opacity: isSubmitting ? 0.6 : 1}}
      >
        {isSubmitting ? 'Registrando...' : 'Registrar Empaque'}
      </button>
    </div>
  );
}
