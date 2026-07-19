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
  // Conversión: consumos de RPC a granel por talla (como jalar bins de desverdizado)
  const [selectedGranelTalla, setSelectedGranelTalla] = useState('');
  const [selectedGranelCant, setSelectedGranelCant] = useState('');
  const [consumosGranel, setConsumosGranel] = useState<
    Array<{ talla: string | null; cantidad: number }>
  >([]);
  const [lineasProduccion, setLineasProduccion] = useState<
    Array<{ presentacion: string; talla: string | null; cantidad: number }>
  >([]);
  const [convirtiendo, setConvirtiendo] = useState(false);

  const createEmpaqueMutation = useCreateEmpaque(token);

  /** Stock de RPC a granel agrupado por talla */
  const stockGranelPorTalla = (() => {
    const map = new Map<string, number>();
    for (const i of inventarioFinal) {
      if (i.presentacion !== 'rpc_granel') continue;
      if ((i.producto && i.producto !== 'limon_amarillo') && !i.presentacion) continue;
      const cant = i.cantidad_stock || 0;
      if (cant <= 0) continue;
      const key = i.talla ? String(i.talla) : 'sin_talla';
      map.set(key, (map.get(key) || 0) + cant);
    }
    return Array.from(map.entries())
      .map(([tallaKey, cantidad]) => ({
        talla: tallaKey === 'sin_talla' ? null : tallaKey,
        tallaKey,
        cantidad,
      }))
      .sort((a, b) => {
        const na = a.talla && /^\d+$/.test(a.talla) ? parseInt(a.talla, 10) : 9999;
        const nb = b.talla && /^\d+$/.test(b.talla) ? parseInt(b.talla, 10) : 9999;
        return na - nb;
      });
  })();

  const stockRpcGranel = stockGranelPorTalla.reduce((s, r) => s + r.cantidad, 0);

  const stockDisponibleTalla = (tallaKey: string) => {
    const row = stockGranelPorTalla.find((r) => r.tallaKey === tallaKey);
    const ya = consumosGranel
      .filter((c) => (c.talla || 'sin_talla') === tallaKey)
      .reduce((s, c) => s + c.cantidad, 0);
    return (row?.cantidad || 0) - ya;
  };

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
                // Orden por fecha de corte (más antiguo primero)
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
  };

  /** Convierte los campos fijos de talla (o jugo) en líneas de producción */
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
        // Conversión RPC a granel (por talla) → final
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
        if (consumosGranel.length === 0) {
          return alert('Agrega al menos un consumo de RPC a granel por talla');
        }
        for (const c of consumosGranel) {
          const key = c.talla || 'sin_talla';
          const disp = stockGranelPorTalla.find((r) => r.tallaKey === key)?.cantidad || 0;
          if (c.cantidad > disp) {
            return alert(
              `Stock insuficiente de granel #${c.talla || 's/t'}: hay ${disp}, pediste ${c.cantidad}`
            );
          }
        }
        if (produccion.length === 0) {
          return alert('Agrega producción final (RPC 12/18 o cartón) a partir del granel');
        }
        setConvirtiendo(true);
        try {
          const res = await convertirRpcGranel(token, {
            mercado: mercadoEmpaque,
            consumos_granel: consumosGranel.map((c) => ({
              talla: c.talla,
              cantidad: c.cantidad,
            })),
            produccion,
            numero_empacador: 'EMP-01',
          });
          alert(`✅ ${res.message}`);
          setConsumosGranel([]);
          setSelectedGranelTalla('');
          setSelectedGranelCant('');
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
            'Agrega producción: RPC a granel por talla, RPC/cartón final, o bins jugo'
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
      setConsumosGranel([]);
      setSelectedGranelTalla('');
      setSelectedGranelCant('');
      setLineasProduccion([]);
      setProdPresentacion('');
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
  const esPrimeraConTalla = !!prodPresentacion && prodPresentacion !== 'bins_jugo';

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
                setConsumosGranel([]);
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
                Bins campo → granel por talla / final / jugo
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
                Jalar granel por talla → RPC 12/18 o cartón
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
              <strong>
                Inventario RPC a granel (22 kg) — total {stockRpcGranel} unidades
              </strong>
              <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 10px' }}>
                Igual que jalar un bin de campo: selecciona talla y cantidad de granel a
                convertir. El resto permanece en inventario por tamaño.
              </p>
              {stockGranelPorTalla.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13 }}>
                  No hay RPC a granel en inventario. Primero empaca desde desverdizado y deja
                  granel por talla.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                  {stockGranelPorTalla.map((row) => (
                    <div
                      key={row.tallaKey}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        fontSize: 13,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>
                        <strong style={{ color: '#0369a1' }}>
                          #{row.talla || 's/talla'}
                        </strong>
                        {' · '}
                        Disp: {stockDisponibleTalla(row.tallaKey)} / stock {row.cantidad}
                        {' · '}
                        {(KG_POR_PRESENTACION.rpc_granel || 22) * row.cantidad} kg
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedGranelTalla(row.tallaKey)}
                        style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}
                      >
                        Seleccionar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedGranelTalla && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13 }}>
                    Talla:{' '}
                    <strong>
                      #{selectedGranelTalla === 'sin_talla' ? 's/talla' : selectedGranelTalla}
                    </strong>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={stockDisponibleTalla(selectedGranelTalla)}
                    placeholder="Cantidad"
                    value={selectedGranelCant}
                    onChange={(e) => setSelectedGranelCant(e.target.value)}
                    style={{
                      width: 90,
                      padding: 8,
                      background: 'white',
                      color: '#0f172a',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cant = parseInt(selectedGranelCant, 10) || 0;
                      const disp = stockDisponibleTalla(selectedGranelTalla);
                      if (cant <= 0) return alert('Cantidad debe ser > 0');
                      if (cant > disp) {
                        return alert(`Solo hay ${disp} disponibles de esa talla`);
                      }
                      setConsumosGranel([
                        ...consumosGranel,
                        {
                          talla:
                            selectedGranelTalla === 'sin_talla' ? null : selectedGranelTalla,
                          cantidad: cant,
                        },
                      ]);
                      setSelectedGranelCant('');
                      setSelectedGranelTalla('');
                    }}
                    style={{
                      padding: '8px 12px',
                      background: '#0369a1',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Agregar consumo
                  </button>
                </div>
              )}

              {consumosGranel.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <strong>Consumos granel:</strong>{' '}
                  {consumosGranel.map((c, i) => (
                    <span key={i} style={{ marginRight: 8 }}>
                      #{c.talla || 's/t'}:{c.cantidad}{' '}
                      <button
                        type="button"
                        onClick={() =>
                          setConsumosGranel(consumosGranel.filter((_, j) => j !== i))
                        }
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
                  Flujo: lavado → <strong>RPC a granel 22 kg por talla</strong> y/o final; 2da =
                  bins jugo. El granel no embolsado queda en inventario por tamaño. RPC final:
                  tallas 140+ · Cartón: ≤140.
                </>
              ) : (
                <>
                  Con los consumos de granel por talla, produce <strong>RPC 12 / 18</strong> o{' '}
                  <strong>cartón</strong>. No se consumen bins de desverdizado.
                </>
              )}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(modoLimon === 'desverdizado'
                ? ([
                    {
                      value: 'rpc_granel',
                      label: 'RPC a granel',
                      hint: '22 kg · por talla',
                    },
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
                  {prodPresentacion === 'rpc_granel' && (
                    <span style={{ fontWeight: 400, color: '#0369a1' }}>
                      {' '}
                      (granel 22 kg · inventario por tamaño)
                    </span>
                  )}
                  {esPresentacionRpc(prodPresentacion) && (
                    <span style={{ fontWeight: 400, color: '#0369a1' }}> (RPC final)</span>
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
