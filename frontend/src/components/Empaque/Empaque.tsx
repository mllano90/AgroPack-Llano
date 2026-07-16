import { useState, useEffect } from 'react';
import type { TipoMercado, InventarioCampoItem, Variedad, TipoCultivo, Producto } from '../../types';
import { TipoCultivoSelect, InventarioCampoSelector } from '../ui';
import { useCreateEmpaque } from '../../hooks/useCreateEmpaque';
import { getApiBaseUrl } from '../../lib/api';
import {
  TALLAS_LIMON,
  PRESENTACIONES_LIMON,
  PESO_BIN_CAMPO_KG,
} from '../../lib/constants';

interface EmpaqueProps {
  token: string;
  inventarioCampo: InventarioCampoItem[];
  onEmpaqueRegistered: () => void;
}

type TallaCantidades = Record<string, string>;

function emptyTallas(): TallaCantidades {
  return Object.fromEntries(TALLAS_LIMON.map((t) => [t, '']));
}

export default function Empaque({ token, inventarioCampo, onEmpaqueRegistered }: EmpaqueProps) {
  const [productoEmpaque, setProductoEmpaque] = useState<Producto | ''>('');
  const [variedadEmpaque, setVariedadEmpaque] = useState<Variedad | ''>('');
  const [cajasCampoUsadas, setCajasCampoUsadas] = useState('');
  const [cajasCartonProducidas, setCajasCartonProducidas] = useState('');
  const [tipoCultivoEmpaque, setTipoCultivoEmpaque] = useState<TipoCultivo | ''>('');
  const [mercadoEmpaque, setMercadoEmpaque] = useState<TipoMercado>('nacional');

  // Limón: consumos desverdizado
  const [desverdizadoList, setDesverdizadoList] = useState<any[]>([]);
  const [selectedLote, setSelectedLote] = useState('');
  const [selectedBinsToUse, setSelectedBinsToUse] = useState('');
  const [consumosDesverdizado, setConsumosDesverdizado] = useState<any[]>([]);

  // Producción: presentación + campos fijos de talla
  const [prodPresentacion, setProdPresentacion] = useState('');
  const [tallaCantidades, setTallaCantidades] = useState<TallaCantidades>(emptyTallas);
  const [cantidadBinsJugo, setCantidadBinsJugo] = useState('');
  const [lineasProduccion, setLineasProduccion] = useState<
    Array<{ presentacion: string; talla: string | null; cantidad: number }>
  >([]);

  const createEmpaqueMutation = useCreateEmpaque(token);

  const formatFechaCorta = (fecha: string) => {
    if (!fecha) return '';
    const date = new Date(fecha);
    if (isNaN(date.getTime())) return fecha;
    const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const d = String(date.getDate()).padStart(2, '0');
    const mes = meses[date.getMonth()];
    const y = date.getFullYear();
    return `${d} ${mes} ${y}`;
  };

  useEffect(() => {
    if (productoEmpaque === 'limon_amarillo' && token) {
      const base = getApiBaseUrl();
      fetch(`${base}/api/recepcion/desverdizado`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then(setDesverdizadoList)
        .catch(() => setDesverdizadoList([]));
    }
  }, [productoEmpaque, token]);

  const resetLimonProduccionForm = () => {
    setTallaCantidades(emptyTallas());
    setCantidadBinsJugo('');
  };

  /** Convierte los campos fijos de talla (o bins jugo) en líneas de producción */
  const agregarPresentacionConTallas = () => {
    if (!prodPresentacion) {
      return alert('Selecciona una presentación');
    }

    if (prodPresentacion === 'bins_jugo') {
      const cant = parseInt(cantidadBinsJugo, 10) || 0;
      if (cant <= 0) return alert('Ingresa la cantidad de bins de jugo');
      setLineasProduccion([
        ...lineasProduccion,
        { presentacion: 'bins_jugo', talla: null, cantidad: cant },
      ]);
      setCantidadBinsJugo('');
      return;
    }

    const nuevas: Array<{ presentacion: string; talla: string | null; cantidad: number }> = [];
    for (const t of TALLAS_LIMON) {
      const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
      if (cant > 0) {
        nuevas.push({ presentacion: prodPresentacion, talla: t, cantidad: cant });
      }
    }
    if (nuevas.length === 0) {
      return alert('Llena al menos una talla con cantidad mayor a 0');
    }
    setLineasProduccion([...lineasProduccion, ...nuevas]);
    setTallaCantidades(emptyTallas());
  };

  const eliminarLineaProduccion = (idx: number) => {
    setLineasProduccion(lineasProduccion.filter((_, i) => i !== idx));
  };

  const registrarEmpaque = async () => {
    if (!productoEmpaque) return alert('Selecciona un producto');

    try {
      const payload: any = {
        producto: productoEmpaque,
        mercado: mercadoEmpaque,
        porcentaje_merma: 0,
        notas_merma: '',
        numero_empacador: 'EMP-01',
      };

      if (productoEmpaque === 'uva') {
        if (!variedadEmpaque || !cajasCampoUsadas || !cajasCartonProducidas || !tipoCultivoEmpaque) {
          return alert('Completa todos los campos para Uva');
        }
        payload.variedad = variedadEmpaque;
        payload.cantidad_cajas_campo_usadas = parseInt(cajasCampoUsadas);
        payload.tipo_cultivo = tipoCultivoEmpaque;
        payload.cantidad_cajas_carton_producidas = parseInt(cajasCartonProducidas);
        payload.porcentaje_merma = parseFloat(
          (
            ((parseInt(cajasCampoUsadas) - parseInt(cajasCartonProducidas)) /
              parseInt(cajasCampoUsadas)) *
            100
          ).toFixed(2)
        );
      } else {
        if (consumosDesverdizado.length === 0) {
          return alert('Agrega al menos un consumo de desverdizado');
        }
        // Si hay tallas llenas sin "Agregar", las incluimos al registrar
        let produccion = [...lineasProduccion];
        if (prodPresentacion === 'bins_jugo') {
          const cant = parseInt(cantidadBinsJugo, 10) || 0;
          if (cant > 0) {
            produccion.push({ presentacion: 'bins_jugo', talla: null, cantidad: cant });
          }
        } else if (prodPresentacion) {
          for (const t of TALLAS_LIMON) {
            const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
            if (cant > 0) {
              produccion.push({ presentacion: prodPresentacion, talla: t, cantidad: cant });
            }
          }
        }
        if (produccion.length === 0) {
          return alert('Agrega producción: elige presentación y llena al menos una talla (o bins jugo)');
        }
        payload.consumos_desverdizado = consumosDesverdizado;
        payload.produccion = produccion;
        payload.cantidad_cajas_campo_usadas = 0;
        payload.cantidad_cajas_carton_producidas = 0;
      }

      await createEmpaqueMutation.mutateAsync(payload);
      alert('✅ Empaque registrado');
      setCajasCampoUsadas('');
      setCajasCartonProducidas('');
      setVariedadEmpaque('');
      setMercadoEmpaque('nacional');
      setConsumosDesverdizado([]);
      setSelectedLote('');
      setSelectedBinsToUse('');
      setLineasProduccion([]);
      setProdPresentacion('');
      resetLimonProduccionForm();
      onEmpaqueRegistered();
      const base = getApiBaseUrl();
      fetch(`${base}/api/recepcion/desverdizado`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then(setDesverdizadoList)
        .catch(() => {});
    } catch (err: any) {
      console.error('Full empaque error:', err);
      let message = 'Error desconocido';
      if (err.response?.data) {
        const data = err.response.data;
        message =
          data.detail ||
          data.message ||
          (Array.isArray(data) ? JSON.stringify(data) : JSON.stringify(data));
      } else if (err.request) {
        message = 'No se pudo conectar con el servidor (posiblemente el backend está reiniciando o caído)';
      } else {
        message = err.message || String(err);
      }
      alert('Error: ' + message);
    }
  };

  const isSubmitting = createEmpaqueMutation.isPending;
  const esPrimera = prodPresentacion && prodPresentacion !== 'bins_jugo';

  return (
    <div style={{ background: 'white', padding: '25px', borderRadius: '10px' }}>
      <h2>Empaque - Transformación</h2>

      <select
        value={productoEmpaque}
        onChange={(e) => {
          const val = e.target.value as Producto | '';
          setProductoEmpaque(val);
          setCajasCampoUsadas('');
          setCajasCartonProducidas('');
          setTipoCultivoEmpaque('');
          setConsumosDesverdizado([]);
          setSelectedLote('');
          setSelectedBinsToUse('');
          setLineasProduccion([]);
          setProdPresentacion('');
          resetLimonProduccionForm();
        }}
        style={{ width: '100%', padding: 12, margin: '8px 0' }}
      >
        <option value="">Seleccionar producto</option>
        <option value="uva">Uva</option>
        <option value="limon_amarillo">Limón Amarillo</option>
      </select>

      {productoEmpaque === 'uva' && (
        <>
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
          <input
            type="number"
            placeholder="Cajas de Campo a Usar"
            value={cajasCampoUsadas}
            onChange={(e) => setCajasCampoUsadas(e.target.value)}
            style={{ width: '100%', padding: '12px', margin: '8px 0' }}
          />
          <input
            type="number"
            placeholder="Cajas de Cartón Producidas"
            value={cajasCartonProducidas}
            onChange={(e) => setCajasCartonProducidas(e.target.value)}
            style={{ width: '100%', padding: '12px', margin: '8px 0' }}
          />
          <TipoCultivoSelect value={tipoCultivoEmpaque} onChange={setTipoCultivoEmpaque} />
        </>
      )}

      {productoEmpaque === 'limon_amarillo' && (
        <>
          <div style={{ margin: '8px 0' }}>
            <strong>Inventario Desverdizado (bins de {PESO_BIN_CAMPO_KG} kg):</strong>
            {desverdizadoList.length === 0 && (
              <div style={{ color: '#666' }}>No hay lotes disponibles</div>
            )}
            {desverdizadoList.map((d: any) => (
              <div
                key={d.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', fontSize: 13 }}
              >
                <span>
                  Lote: <strong>{d.lote}</strong> | Bins disp: {d.cantidad_bins_disponibles} | Tentativa:{' '}
                  {formatFechaCorta(d.fecha_tentativa_salida)}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedLote(d.lote)}
                  style={{ padding: '2px 8px', fontSize: 12 }}
                >
                  Seleccionar
                </button>
              </div>
            ))}
          </div>

          {selectedLote && (
            <div style={{ display: 'flex', gap: 8, margin: '4px 0', alignItems: 'center' }}>
              <span>Lote: {selectedLote}</span>
              <input
                type="number"
                placeholder="Bins a usar"
                value={selectedBinsToUse}
                onChange={(e) => setSelectedBinsToUse(e.target.value)}
                style={{ width: 80 }}
              />
              <button
                type="button"
                onClick={() => {
                  const binsNum = parseInt(selectedBinsToUse) || 0;
                  if (binsNum > 0) {
                    setConsumosDesverdizado([
                      ...consumosDesverdizado,
                      { lote: selectedLote, bins: binsNum },
                    ]);
                    setSelectedBinsToUse('');
                    setSelectedLote('');
                  }
                }}
              >
                Agregar
              </button>
            </div>
          )}

          {consumosDesverdizado.length > 0 && (
            <div style={{ margin: '4px 0', fontSize: 12 }}>
              <strong>Consumos:</strong>{' '}
              {consumosDesverdizado.map((c, i) => (
                <span key={i} style={{ marginRight: 8 }}>
                  {c.lote}:{c.bins}{' '}
                  <button
                    type="button"
                    onClick={() =>
                      setConsumosDesverdizado(consumosDesverdizado.filter((_, j) => j !== i))
                    }
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Presentación + todas las tallas fijas */}
          <div
            style={{
              margin: '16px 0',
              padding: '14px',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              background: '#fafafa',
            }}
          >
            <strong>Producción</strong>
            <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 12px' }}>
              Elige la presentación y llena las cantidades por talla en un solo paso.
            </p>

            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Presentación *</label>
            <select
              value={prodPresentacion}
              onChange={(e) => {
                setProdPresentacion(e.target.value);
                resetLimonProduccionForm();
              }}
              style={{ width: '100%', maxWidth: 320, padding: '10px', marginBottom: 12 }}
            >
              <option value="">Seleccionar presentación</option>
              {PRESENTACIONES_LIMON.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            {esPrimera && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Cantidades por talla
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {TALLAS_LIMON.map((t) => (
                    <div key={t}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: '#475569',
                          marginBottom: 2,
                        }}
                      >
                        #{t}
                      </label>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={tallaCantidades[t] || ''}
                        onChange={(e) =>
                          setTallaCantidades({ ...tallaCantidades, [t]: e.target.value })
                        }
                        style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {prodPresentacion === 'bins_jugo' && (
              <div>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                  Cantidad bins 900kg (2da)
                </label>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={cantidadBinsJugo}
                  onChange={(e) => setCantidadBinsJugo(e.target.value)}
                  style={{ width: '100%', maxWidth: 200, padding: '10px' }}
                />
              </div>
            )}

            {prodPresentacion && (
              <button
                type="button"
                onClick={agregarPresentacionConTallas}
                style={{
                  marginTop: 14,
                  padding: '10px 18px',
                  background: '#15803d',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Agregar a producción
              </button>
            )}
          </div>

          {lineasProduccion.length > 0 && (
            <div style={{ margin: '8px 0', fontSize: 13 }}>
              <strong>Producción agregada:</strong>
              <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
                {lineasProduccion.map((l, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {l.presentacion}
                    {l.talla ? ` #${l.talla}` : ''} × {l.cantidad}{' '}
                    <button
                      type="button"
                      onClick={() => eliminarLineaProduccion(i)}
                      style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}
                    >
                      quitar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={registrarEmpaque}
        disabled={isSubmitting || !productoEmpaque}
        style={{
          padding: '12px 30px',
          marginTop: '15px',
          opacity: isSubmitting || !productoEmpaque ? 0.6 : 1,
        }}
      >
        {isSubmitting ? 'Registrando...' : 'Registrar Empaque'}
      </button>
    </div>
  );
}
