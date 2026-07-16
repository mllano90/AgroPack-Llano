import { useState } from 'react';
import type { TipoMercado, TipoRecepcion, Variedad, TipoCultivo, Producto } from '../../types';
import { VariedadSelect, MercadoSelect, TipoCultivoSelect } from '../ui';
import { useCreateRecepcion } from '../../hooks/useCreateRecepcion';
import { LOTES_LIMON, PESO_BIN_CAMPO_KG } from '../../lib/constants';

interface RecepcionProps {
  token: string;
  onRecepcionRegistered: () => void;
}

export default function Recepcion({ token, onRecepcionRegistered }: RecepcionProps) {
  const [tipoRecepcion, setTipoRecepcion] = useState<TipoRecepcion>('campo');
  const [productoRecepcion, setProductoRecepcion] = useState<Producto | ''>('');
  const [variedadRecepcion, setVariedadRecepcion] = useState<Variedad | ''>('');
  const [tipoCultivoRecepcion, setTipoCultivoRecepcion] = useState<TipoCultivo | ''>('');
  const [mercadoRecepcion, setMercadoRecepcion] = useState<TipoMercado>('nacional');
  const [cantidadRecepcion, setCantidadRecepcion] = useState('');
  
  // Campos para Limón
  const [lote, setLote] = useState('');
  const [cantidadBins, setCantidadBins] = useState('');
  const [fechaCorte, setFechaCorte] = useState('');

  const createRecepcionMutation = useCreateRecepcion(token);

  const registrarRecepcion = async () => {
    if (!productoRecepcion) return alert("Selecciona un producto");

    let payload: any;

    if (productoRecepcion === 'uva') {
      if (!variedadRecepcion || !cantidadRecepcion) return alert("Faltan datos");
      const cantidad = parseInt(cantidadRecepcion);
      payload = {
        producto: 'uva',
        variedad: variedadRecepcion as Variedad,
        cantidad_cajas_campo: tipoRecepcion === 'campo' ? cantidad : 0,
        cantidad_cajas_carton: tipoRecepcion === 'carton' ? cantidad : 0,
        tipo_cultivo_carton: tipoRecepcion === 'carton' ? (tipoCultivoRecepcion as TipoCultivo) : null,
        mercado: mercadoRecepcion,
      };
    } else {
      const bins = parseInt(cantidadBins) || 0;
      if (!lote || bins <= 0) return alert("Faltan lote o cantidad de bins para Limón");
      payload = {
        producto: 'limon_amarillo',
        lote: lote,
        cantidad_bins: bins,
        fecha_corte: fechaCorte || null,
        // no enviar campos de uva
      };
    }

    try {
      await createRecepcionMutation.mutateAsync(payload);
      alert('✅ Recepción registrada correctamente');
      setCantidadRecepcion('');
      setLote('');
      setCantidadBins('');
      setFechaCorte('');
      onRecepcionRegistered();
    } catch (err: any) {
      console.error('Full error object:', err);
      let message = 'Error desconocido';
      if (err.response?.data) {
        const data = err.response.data;
        message = data.detail || data.message || (Array.isArray(data) ? JSON.stringify(data) : JSON.stringify(data));
      } else if (err.request) {
        message = 'No se pudo conectar con el servidor (posiblemente el backend está reiniciando o caído)';
      } else {
        message = err.message;
      }
      alert('Error: ' + message);
    }
  };

  const isSubmitting = createRecepcionMutation.isPending;

  return (
    <div style={{background: 'white', padding: '25px', borderRadius: '10px'}}>
      <h2>Recepción de Campo</h2>

      {/* Producto */}
      <select 
        value={productoRecepcion} 
        onChange={(e) => {
          const val = e.target.value as Producto | '';
          setProductoRecepcion(val);
          // Limpiar campos al cambiar de producto para empezar en blanco
          setCantidadRecepcion('');
          setLote('');
          setCantidadBins('');
          setFechaCorte('');
          setVariedadRecepcion('');
          setTipoCultivoRecepcion('');
        }} 
        style={{width: '100%', padding: '12px', margin: '10px 0'}}
      >
        <option value="">Seleccionar producto</option>
        <option value="uva">Uva</option>
        <option value="limon_amarillo">Limón Amarillo</option>
      </select>

      {/* Campos solo para Uva */}
      {productoRecepcion === 'uva' && (
        <>
          <select 
            value={tipoRecepcion} 
            onChange={(e) => setTipoRecepcion(e.target.value as 'campo' | 'carton')} 
            style={{width: '100%', padding: '12px', margin: '10px 0'}}
          >
            <option value="campo">Caja de Campo</option>
            <option value="carton">Caja de Cartón Lista</option>
          </select>

          <VariedadSelect
            value={variedadRecepcion}
            onChange={setVariedadRecepcion}
          />

          {tipoRecepcion === 'carton' && (
            <TipoCultivoSelect
              value={tipoCultivoRecepcion}
              onChange={setTipoCultivoRecepcion}
            />
          )}

          <MercadoSelect
            value={mercadoRecepcion}
            onChange={setMercadoRecepcion}
          />

          <input 
            type="number" 
            placeholder="Cantidad de cajas" 
            value={cantidadRecepcion} 
            onChange={(e) => setCantidadRecepcion(e.target.value)} 
            style={{width: '100%', padding: '12px', margin: '10px 0'}} 
          />
        </>
      )}

      {/* Campos solo para Limón */}
      {productoRecepcion === 'limon_amarillo' && (
        <>
          <select
            value={lote}
            onChange={(e) => setLote(e.target.value)}
            style={{ width: '100%', padding: '12px', margin: '10px 0' }}
          >
            <option value="">Seleccionar lote</option>
            {LOTES_LIMON.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder={`Cantidad de bins (${PESO_BIN_CAMPO_KG}kg c/u)`}
            value={cantidadBins}
            onChange={(e) => setCantidadBins(e.target.value)}
            style={{ width: '100%', padding: '12px', margin: '10px 0' }}
          />
          <input
            type="date"
            value={fechaCorte}
            onChange={(e) => setFechaCorte(e.target.value)}
            style={{ width: '100%', padding: '12px', margin: '10px 0' }}
          />
        </>
      )}

      <button 
        onClick={registrarRecepcion} 
        disabled={isSubmitting}
        style={{padding: '12px 30px', marginTop: '10px', opacity: isSubmitting ? 0.6 : 1}}
      >
        Registrar Recepción
      </button>
    </div>
  );
}
