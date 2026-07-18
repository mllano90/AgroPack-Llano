import { useState, useEffect } from 'react';
import type {
  TipoMercado,
  InventarioCampoItem,
  InventarioFinalItem,
  Variedad,
  TipoCultivo,
  Producto,
} from '../../types';
import { TipoCultivoSelect, InventarioCampoSelector } from '../ui';
import { useCreateEmpaque } from '../../hooks/useCreateEmpaque';
import { getApiBaseUrl, convertirRpcGranel } from '../../lib/api';
import {
  TALLAS_LIMON,
  PESO_BIN_CAMPO_KG,
  tallasParaPresentacion,
  esPresentacionRpc,
  esPresentacionCarton,
  labelPresentacionLimon,
  KG_POR_PRESENTACION,
} from '../../lib/constants';
import { formatFechaCorta } from '../../lib/dates';

interface EmpaqueProps {
  token: string;
  inventarioCampo: InventarioCampoItem[];
  inventarioFinal?: InventarioFinalItem[];
  onEmpaqueRegistered: () => void;
}

type TallaCantidades = Record<string, string>;
type ModoLimon = 'desverdizado' | 'granel';

function emptyTallas(tallas: readonly string[] = TALLAS_LIMON): TallaCantidades {
  return Object.fromEntries(tallas.map((t) => [t, '']));
}

function labelPresentacion(p: string) {
  return labelPresentacionLimon(p);
}

export default function Empaque({
  token,
  inventarioCampo,
  inventarioFinal = [],
  onEmpaqueRegistered,
}: EmpaqueProps) {
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
  const [modoLimon, setModoLimon] = useState<ModoLimon>('desverdizado');
  const [prodPresentacion, setProdPresentacion] = useState('');
  const [tallaCantidades, setTallaCantidades] = useState<TallaCantidades>(emptyTallas);
  const [cantidadBinsJugo, setCantidadBinsJugo] = useState('');
  const [cantidadRpcGranel, setCantidadRpcGranel] = useState('');
  // Conversión: cuántos RPC a granel se consumen
  const [granelAUsar, setGranelAUsar] = useState('');
  const [lineasProduccion, setLineasProduccion] = useState<
    Array<{ presentacion: string; talla: string | null; cantidad: number }>
  >([]);
  const [convirtiendo, setConvirtiendo] = useState(false);

  const createEmpaqueMutation = useCreateEmpaque(token);

  const stockRpcGranel = inventarioFinal
    .filter(
      (i) =>
        (i.producto === 'limon_amarillo' || !!i.presentacion) &&
        i.presentacion === 'rpc_granel' &&
        (i.cantidad_stock || 0) > 0
    )
    .reduce((s, i) => s + (i.cantidad_stock || 0), 0);

  const cargarDesverdizado = () => {
    if (!token) return;
    const base = getApiBaseUrl().replace(/\/$/, '');
    fetch(`${base}/api/recepcion/desverdizado`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data)
          ? data
              .filter(
                (d: any) =>
                  (d.cantidad_bins_disponibles || 0) > 0 &&
                  d.estado !== 'eliminado' &&
                  d.estado !== 'empaquetado'
              )
              .sort((a: any, b: any) => {
                const fa = String(a.fecha_recepcion || '');
                const fb = String(b.fecha_recepcion || '');
                if (fa !== fb) return fa.localeCompare(fb);
                return (a.id || 0) - (b.id || 0);
              })
          : [];
        setDesverdizadoList(list);
      })
      .catch(() => setDesverdizadoList([]));
  };

  useEffect(() => {
    if (productoEmpaque === 'limon_amarillo' && token) {
      cargarDesverdizado();
    }
  }, [productoEmpaque, token]);

  const tallasActivas = tallasParaPresentacion(prodPresentacion);

  const resetLimonProduccionForm = (presentacion?: string) => {
    const tallas = tallasParaPresentacion(presentacion || prodPresentacion);
    setTallaCantidades(emptyTallas(tallas.length ? tallas : TALLAS_LIMON));
    setCantidadBinsJugo('');
    setCantidadRpcGranel('');
  };

  /** Convierte los campos fijos de talla (o jugo/granel) en líneas de producción */
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

    if (prodPresentacion === 'rpc_granel') {
      const cant = parseInt(cantidadRpcGranel, 10) || 0;
      if (cant <= 0) return alert('Ingresa la cantidad de RPC a granel (22 kg c/u)');
      setLineasProduccion([
        ...lineasProduccion,
        { presentacion: 'rpc_granel', talla: null, cantidad: cant },
      ]);
      setCantidadRpcGranel('');
      return;
    }

    const tallas = tallasParaPresentacion(prodPresentacion);
    const nuevas: Array<{ presentacion: string; talla: string | null; cantidad: number }> = [];
    for (const t of tallas) {
      const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
      if (cant > 0) {
        nuevas.push({ presentacion: prodPresentacion, talla: t, cantidad: cant });
      }
    }
    if (nuevas.length === 0) {
      return alert('Llena al menos una talla con cantidad mayor a 0');
    }
    setLineasProduccion([...lineasProduccion, ...nuevas]);
    setTallaCantidades(emptyTallas(tallas));
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
      } else if (modoLimon === 'granel') {
        // Conversión RPC a granel → final (no usa desverdizado)
        const cantGranel = parseInt(granelAUsar, 10) || 0;
        let produccion = [...lineasProduccion];
        if (prodPresentacion && prodPresentacion !== 'rpc_granel' && prodPresentacion !== 'bins_jugo') {
          for (const t of tallasParaPresentacion(prodPresentacion)) {
            const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
            if (cant > 0) {
              produccion.push({ presentacion: prodPresentacion, talla: t, cantidad: cant });
            }
          }
        }
        produccion = produccion.filter(
          (p) => p.presentacion !== 'rpc_granel' && p.presentacion !== 'bins_jugo'
        );
        if (cantGranel <= 0) return alert('Indica cuántos RPC a granel vas a convertir');
        if (cantGranel > stockRpcGranel) {
          return alert(`Solo hay ${stockRpcGranel} RPC a granel en inventario`);
        }
        if (produccion.length === 0) {
          return alert('Agrega producción final (RPC 12/18 o cartón) a partir del granel');
        }
        setConvirtiendo(true);
        try {
          const res = await convertirRpcGranel(token, {
            mercado: mercadoEmpaque,
            cantidad_rpc_granel: cantGranel,
            produccion,
            numero_empacador: 'EMP-01',
          });
          alert(`✅ ${res.message}`);
          setGranelAUsar('');
          setLineasProduccion([]);
          setProdPresentacion('');
          resetLimonProduccionForm();
          onEmpaqueRegistered();
        } finally {
          setConvirtiendo(false);
        }
        return;
      } else {
        if (consumosDesverdizado.length === 0) {
          return alert('Agrega al menos un consumo de desverdizado');
        }
        // Si hay tallas/cantidades llenas sin "Agregar", las incluimos al registrar
        let produccion = [...lineasProduccion];
        if (prodPresentacion === 'bins_jugo') {
          const cant = parseInt(cantidadBinsJugo, 10) || 0;
          if (cant > 0) {
            produccion.push({ presentacion: 'bins_jugo', talla: null, cantidad: cant });
          }
        } else if (prodPresentacion === 'rpc_granel') {
          const cant = parseInt(cantidadRpcGranel, 10) || 0;
          if (cant > 0) {
            produccion.push({ presentacion: 'rpc_granel', talla: null, cantidad: cant });
          }
        } else if (prodPresentacion) {
          for (const t of tallasParaPresentacion(prodPresentacion)) {
            const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
            if (cant > 0) {
              produccion.push({ presentacion: prodPresentacion, talla: t, cantidad: cant });
            }
          }
        }
        if (produccion.length === 0) {
          return alert(
            'Agrega producción: RPC a granel, RPC/cartón final, o bins jugo'
          );
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
      setCantidadRpcGranel('');
      resetLimonProduccionForm();
      onEmpaqueRegistered();
      cargarDesverdizado();
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

  const isSubmitting = createEmpaqueMutation.isPending || convirtiendo;
  const esPrimeraConTalla =
    prodPresentacion &&
    prodPresentacion !== 'bins_jugo' &&
    prodPresentacion !== 'rpc_granel';

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
            <button
              type="button"
              onClick={() => {
                setModoLimon('desverdizado');
                setLineasProduccion([]);
                setProdPresentacion('');
                resetLimonProduccionForm();
              }}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                border: modoLimon === 'desverdizado' ? '2px solid #15803d' : '1px solid #cbd5e1',
                background: modoLimon === 'desverdizado' ? '#dcfce7' : '#fff',
                color: '#0f172a',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              1. Desde desverdizado
              <div style={{ fontSize: 11, fontWeight: 400, color: '#64748b' }}>
                Bins campo → RPC granel / final / jugo
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setModoLimon('granel');
                setConsumosDesverdizado([]);
                setLineasProduccion([]);
                setProdPresentacion('');
                resetLimonProduccionForm();
              }}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                border: modoLimon === 'granel' ? '2px solid #0369a1' : '1px solid #cbd5e1',
                background: modoLimon === 'granel' ? '#e0f2fe' : '#fff',
                color: '#0f172a',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              2. Desde RPC a granel
              <div style={{ fontSize: 11, fontWeight: 400, color: '#64748b' }}>
                Embolsar granel → RPC 12/18 o cartón
              </div>
            </button>
          </div>

          {modoLimon === 'granel' && (
            <div
              style={{
                margin: '8px 0 16px',
                padding: 14,
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: 8,
              }}
            >
              <strong>Stock RPC a granel (22 kg): {stockRpcGranel} unidades</strong>
              <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 10px' }}>
                Consume granel del inventario final y genera producto embolsado/final. El granel no
                usado permanece en inventario.
              </p>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                RPC a granel a convertir *
              </label>
              <input
                type="number"
                min={1}
                max={stockRpcGranel}
                value={granelAUsar}
                onChange={(e) => setGranelAUsar(e.target.value)}
                style={{
                  padding: 10,
                  width: 140,
                  background: 'white',
                  color: '#0f172a',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                }}
              />
            </div>
          )}

          {modoLimon === 'desverdizado' && (
            <>
              <div style={{ margin: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                  <strong>Inventario Desverdizado (bins de {PESO_BIN_CAMPO_KG} kg):</strong>
                  <button
                    type="button"
                    onClick={cargarDesverdizado}
                    style={{ padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}
                  >
                    Actualizar lista
                  </button>
                </div>
                {desverdizadoList.length === 0 && (
                  <div style={{ color: '#666' }}>No hay lotes disponibles</div>
                )}
                {desverdizadoList.map((d: any) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      margin: '4px 0',
                      fontSize: 13,
                    }}
                  >
                    <span>
                      <strong style={{ color: '#15803d' }}>
                        Tanda #{d.numero_tanda ?? '—'}
                      </strong>
                      {' · '}
                      Lote: <strong>{d.lote}</strong> | Bins disp:{' '}
                      {d.cantidad_bins_disponibles} | Corte:{' '}
                      {formatFechaCorta(d.fecha_recepcion)}
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
                          setConsumosDesverdizado(
                            consumosDesverdizado.filter((_, j) => j !== i)
                          )
                        }
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Presentación + tallas filtradas */}
          <div
            style={{
              margin: '16px 0',
              padding: '14px',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              background: '#fafafa',
            }}
          >
            <strong>
              {modoLimon === 'desverdizado'
                ? 'Producción (desde bins de campo)'
                : 'Producción final (desde RPC a granel)'}
            </strong>
            <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 12px' }}>
              {modoLimon === 'desverdizado' ? (
                <>
                  Flujo: lavado → <strong>RPC a granel (22 kg)</strong> y/o final; 2da = bins jugo.
                  El granel no embolsado queda en inventario. RPC final: tallas 140+ · Cartón: ≤140.
                </>
              ) : (
                <>
                  Embolsa RPC a granel en <strong>RPC 12 / 18</strong> o <strong>cartón</strong>. No
                  se consumen bins de desverdizado.
                </>
              )}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(modoLimon === 'desverdizado'
                ? ([
                    { value: 'rpc_granel', label: 'RPC a granel', hint: '22 kg · 1ra en proceso' },
                    { value: 'rpc_18', label: 'RPC 18', hint: 'tallas 140+' },
                    { value: 'rpc_12', label: 'RPC 12', hint: 'tallas 140+' },
                    { value: 'caja_40lbs', label: 'Cartón 40 lbs', hint: 'tallas ≤140' },
                    { value: 'bins_jugo', label: 'Bins jugo (2da)', hint: '900 kg' },
                  ] as const)
                : ([
                    { value: 'rpc_18', label: 'RPC 18', hint: 'tallas 140+' },
                    { value: 'rpc_12', label: 'RPC 12', hint: 'tallas 140+' },
                    { value: 'caja_40lbs', label: 'Cartón 40 lbs', hint: 'tallas ≤140' },
                  ] as const)
              ).map((opt) => {
                const active = prodPresentacion === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setProdPresentacion(opt.value);
                      resetLimonProduccionForm(opt.value);
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: active ? '2px solid #15803d' : '1px solid #cbd5e1',
                      background: active ? '#dcfce7' : '#ffffff',
                      color: '#0f172a',
                      cursor: 'pointer',
                      textAlign: 'left',
                      minWidth: 120,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: '#475569' }}>{opt.hint}</div>
                  </button>
                );
              })}
            </div>

            {esPrimeraConTalla && tallasActivas.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Cantidades por talla
                  {esPresentacionRpc(prodPresentacion) && (
                    <span style={{ fontWeight: 400, color: '#0369a1' }}> (RPC)</span>
                  )}
                  {esPresentacionCarton(prodPresentacion) && (
                    <span style={{ fontWeight: 400, color: '#a16207' }}> (cartón)</span>
                  )}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {tallasActivas.map((t) => (
                    <div key={t}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: t === '140' ? '#b45309' : '#475569',
                          marginBottom: 2,
                          fontWeight: t === '140' ? 700 : 400,
                        }}
                      >
                        #{t}
                        {t === '140' ? ' *' : ''}
                      </label>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={tallaCantidades[t] || ''}
                        onChange={(e) =>
                          setTallaCantidades({ ...tallaCantidades, [t]: e.target.value })
                        }
                        style={{
                          width: '100%',
                          padding: '8px',
                          boxSizing: 'border-box',
                          background: 'white',
                          color: '#0f172a',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  ))}
                </div>
                {tallasActivas.includes('140') && (
                  <p style={{ fontSize: 11, color: '#b45309', margin: '8px 0 0' }}>
                    * Talla 140: válida en RPC y en cartón (elige la presentación correcta arriba).
                  </p>
                )}
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
                  style={{
                    width: '100%',
                    maxWidth: 200,
                    padding: '10px',
                    background: 'white',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                  }}
                />
              </div>
            )}

            {prodPresentacion === 'rpc_granel' && (
              <div>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                  Cantidad RPC a granel (22 kg c/u, 1ra en proceso)
                </label>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={cantidadRpcGranel}
                  onChange={(e) => setCantidadRpcGranel(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: 200,
                    padding: '10px',
                    background: 'white',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                  }}
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
                    {labelPresentacion(l.presentacion)}
                    {l.talla ? ` #${l.talla}` : ''} × {l.cantidad}
                    {l.presentacion === 'rpc_granel'
                      ? ` (${(KG_POR_PRESENTACION.rpc_granel || 22) * l.cantidad} kg)`
                      : ''}{' '}
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
              {(() => {
                const granel = lineasProduccion
                  .filter((l) => l.presentacion === 'rpc_granel')
                  .reduce((s, l) => s + l.cantidad, 0);
                const rpc = lineasProduccion
                  .filter((l) => esPresentacionRpc(l.presentacion))
                  .reduce((s, l) => s + l.cantidad, 0);
                const carton = lineasProduccion
                  .filter((l) => esPresentacionCarton(l.presentacion))
                  .reduce((s, l) => s + l.cantidad, 0);
                const jugo = lineasProduccion
                  .filter((l) => l.presentacion === 'bins_jugo')
                  .reduce((s, l) => s + l.cantidad, 0);
                if (rpc + carton + jugo + granel === 0) return null;
                return (
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
                    Resumen: Granel {granel} · RPC final {rpc} · Cartón {carton}
                    {jugo > 0 ? ` · Jugo ${jugo}` : ''}
                  </div>
                );
              })()}
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
