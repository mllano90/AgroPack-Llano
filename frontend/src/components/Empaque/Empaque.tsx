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
import { formatFechaCorta, todayInputDate } from '../../lib/dates';

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
  const [fechaEmpaque, setFechaEmpaque] = useState(todayInputDate());

  // Limón: consumos desverdizado (incl. fecha_recepcion: mismo lote puede tener varios cortes)
  const [desverdizadoList, setDesverdizadoList] = useState<any[]>([]);
  /** Fila seleccionada de desverdizado (lote + fecha de corte) */
  const [selectedDesv, setSelectedDesv] = useState<{
    id?: number;
    lote: string;
    fecha_recepcion?: string | null;
    disponible: number;
  } | null>(null);
  const [selectedBinsToUse, setSelectedBinsToUse] = useState('');
  const [consumosDesverdizado, setConsumosDesverdizado] = useState<
    Array<{ lote: string; bins: number; fecha_recepcion?: string | null }>
  >([]);

  // Producción: presentación + campos fijos de talla
  const [modoLimon, setModoLimon] = useState<ModoLimon>('desverdizado');
  const [prodPresentacion, setProdPresentacion] = useState('');
  const [tallaCantidades, setTallaCantidades] = useState<TallaCantidades>(emptyTallas);
  const [cantidadBinsJugo, setCantidadBinsJugo] = useState('');
  /** Lote de origen al producir granel (obligatorio si hay varios consumos) */
  const [loteProduccionGranel, setLoteProduccionGranel] = useState('');
  // Conversión: consumos de RPC a granel por talla + lote
  const [selectedGranelKey, setSelectedGranelKey] = useState('');
  const [selectedGranelCant, setSelectedGranelCant] = useState('');
  const [consumosGranel, setConsumosGranel] = useState<
    Array<{
      talla: string | null;
      lote: string | null;
      fecha_empaque: string | null;
      cantidad: number;
    }>
  >([]);
  type LineaProduccion = {
    presentacion: string;
    talla: string | null;
    cantidad: number;
    lote?: string | null;
    fecha_empaque?: string | null;
    /** Origen de captura: no se borra al cambiar de pestaña */
    origen: 'desverdizado' | 'conversion_granel';
  };
  const [lineasProduccion, setLineasProduccion] = useState<LineaProduccion[]>([]);
  const [convirtiendo, setConvirtiendo] = useState(false);

  const createEmpaqueMutation = useCreateEmpaque(token);

  const lotesEnConsumo = consumosDesverdizado
    .map((c) => String(c.lote || '').trim())
    .filter(Boolean);

  /** Stock granel por talla + lote + fecha de empaque (no mezclar días) */
  const stockGranelRows = (() => {
    type Row = {
      talla: string | null;
      lote: string | null;
      fecha_empaque: string | null;
      cantidad: number;
    };
    const map = new Map<string, Row>();
    for (const i of inventarioFinal) {
      if (i.presentacion !== 'rpc_granel') continue;
      const cant = i.cantidad_stock || 0;
      if (cant <= 0) continue;
      const talla = i.talla ? String(i.talla) : null;
      const lote = i.lote ? String(i.lote).trim() : null;
      const fecha = i.fecha_empaque ? String(i.fecha_empaque).slice(0, 10) : null;
      const key = `${talla || 'sin_talla'}|${lote || 'sin_lote'}|${fecha || 'sin_fecha'}`;
      const prev = map.get(key);
      map.set(key, {
        talla,
        lote,
        fecha_empaque: fecha,
        cantidad: (prev?.cantidad || 0) + cant,
      });
    }
    return Array.from(map.entries())
      .map(([rowKey, v]) => ({ rowKey, ...v }))
      .sort((a, b) => {
        const fa = a.fecha_empaque || '';
        const fb = b.fecha_empaque || '';
        if (fa !== fb) return fa.localeCompare(fb);
        const la = a.lote || '';
        const lb = b.lote || '';
        if (la !== lb) return la.localeCompare(lb);
        const na = a.talla && /^\d+$/.test(a.talla) ? parseInt(a.talla, 10) : 9999;
        const nb = b.talla && /^\d+$/.test(b.talla) ? parseInt(b.talla, 10) : 9999;
        return na - nb;
      });
  })();

  const stockRpcGranel = stockGranelRows.reduce((s, r) => s + r.cantidad, 0);

  const granelKey = (
    talla: string | null | undefined,
    lote: string | null | undefined,
    fecha: string | null | undefined
  ) => `${talla || 'sin_talla'}|${lote || 'sin_lote'}|${fecha || 'sin_fecha'}`;

  const stockDisponibleGranel = (rowKey: string) => {
    const row = stockGranelRows.find((r) => r.rowKey === rowKey);
    const ya = consumosGranel
      .filter((c) => granelKey(c.talla, c.lote, c.fecha_empaque) === rowKey)
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

  /** Origen de la pestaña activa (captura desverdizado vs conversión granel) */
  const origenCaptura = (): LineaProduccion['origen'] =>
    modoLimon === 'granel' ? 'conversion_granel' : 'desverdizado';

  /** Convierte los campos fijos de talla (o jugo) en líneas de producción */
  const agregarPresentacionConTallas = () => {
    if (!prodPresentacion) {
      return alert('Selecciona una presentación');
    }
    const origen = origenCaptura();

    if (prodPresentacion === 'bins_jugo') {
      if (origen === 'conversion_granel') {
        return alert('Bins jugo se capturan en el flujo desde desverdizado');
      }
      const cant = parseInt(cantidadBinsJugo, 10) || 0;
      if (cant <= 0) return alert('Ingresa la cantidad de bins de jugo');
      setLineasProduccion([
        ...lineasProduccion,
        { presentacion: 'bins_jugo', talla: null, cantidad: cant, origen: 'desverdizado' },
      ]);
      setCantidadBinsJugo('');
      return;
    }

    // Lote de origen para granel WIP (solo desde desverdizado)
    let loteOrigen: string | null = null;
    if (prodPresentacion === 'rpc_granel') {
      if (origen === 'conversion_granel') {
        return alert('En conversión elige el granel a consumir en la lista de inventario, no como producción');
      }
      if (lotesEnConsumo.length === 1) {
        loteOrigen = lotesEnConsumo[0];
      } else if (lotesEnConsumo.length > 1) {
        loteOrigen = loteProduccionGranel.trim() || null;
        if (!loteOrigen) {
          return alert(
            'Hay varios lotes en consumo: elige el lote de origen del RPC a granel'
          );
        }
        if (!lotesEnConsumo.includes(loteOrigen)) {
          return alert('El lote de granel debe ser uno de los consumos de desverdizado');
        }
      } else {
        return alert('Agrega primero un consumo de desverdizado (lote de campo)');
      }
    }

    // Conversión granel → final: heredar lote si hay un solo consumo granel
    if (origen === 'conversion_granel') {
      if (prodPresentacion === 'rpc_granel') {
        return alert('La conversión produce RPC 12/18 o cartón, no más granel');
      }
    }

    const tallas = tallasParaPresentacion(prodPresentacion);
    const nuevas: LineaProduccion[] = [];
    for (const t of tallas) {
      const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
      if (cant > 0) {
        const row: LineaProduccion = {
          presentacion: prodPresentacion,
          talla: t,
          cantidad: cant,
          origen,
        };
        if (loteOrigen) {
          row.lote = loteOrigen;
          row.fecha_empaque = fechaEmpaque || null;
        } else if (origen === 'conversion_granel') {
          const lotesG = [
            ...new Set(consumosGranel.map((c) => c.lote).filter(Boolean)),
          ] as string[];
          if (lotesG.length === 1) {
            row.lote = lotesG[0];
          }
          row.fecha_empaque = fechaEmpaque || null;
        } else if (lotesEnConsumo.length === 1) {
          row.lote = lotesEnConsumo[0];
          row.fecha_empaque = fechaEmpaque || null;
        }
        nuevas.push(row);
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
    if (!fechaEmpaque) return alert('La fecha de empaque es obligatoria');

    try {
      const payload: any = {
        producto: productoEmpaque,
        mercado: mercadoEmpaque,
        fecha: fechaEmpaque,
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
        // Limón: puede registrar AMBOS en un solo botón
        // 1) Bins desverdizado → producción (granel WIP / final / jugo)
        // 2) Consumo de granel en inventario → conversión a final
        // Al cambiar de pestaña NO se borra lo capturado.

        const flushFormDesv = (): LineaProduccion[] => {
          const extra: LineaProduccion[] = [];
          if (modoLimon !== 'desverdizado' || !prodPresentacion) return extra;
          if (prodPresentacion === 'bins_jugo') {
            const cant = parseInt(cantidadBinsJugo, 10) || 0;
            if (cant > 0) {
              extra.push({
                presentacion: 'bins_jugo',
                talla: null,
                cantidad: cant,
                origen: 'desverdizado',
              });
            }
            return extra;
          }
          const loteG =
            prodPresentacion === 'rpc_granel'
              ? lotesEnConsumo.length === 1
                ? lotesEnConsumo[0]
                : loteProduccionGranel.trim() || null
              : lotesEnConsumo.length === 1
                ? lotesEnConsumo[0]
                : null;
          if (prodPresentacion === 'rpc_granel' && !loteG) {
            throw new Error('Indica el lote de origen del RPC a granel');
          }
          for (const t of tallasParaPresentacion(prodPresentacion)) {
            const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
            if (cant > 0) {
              extra.push({
                presentacion: prodPresentacion,
                talla: t,
                cantidad: cant,
                lote: loteG,
                fecha_empaque: fechaEmpaque,
                origen: 'desverdizado',
              });
            }
          }
          return extra;
        };

        const flushFormConv = (): LineaProduccion[] => {
          const extra: LineaProduccion[] = [];
          if (modoLimon !== 'granel' || !prodPresentacion) return extra;
          if (
            prodPresentacion === 'rpc_granel' ||
            prodPresentacion === 'bins_jugo'
          ) {
            return extra;
          }
          const lotesUnicos = [
            ...new Set(consumosGranel.map((c) => c.lote).filter(Boolean)),
          ] as string[];
          for (const t of tallasParaPresentacion(prodPresentacion)) {
            const cant = parseInt(tallaCantidades[t] || '', 10) || 0;
            if (cant > 0) {
              extra.push({
                presentacion: prodPresentacion,
                talla: t,
                cantidad: cant,
                lote: lotesUnicos.length === 1 ? lotesUnicos[0] : null,
                fecha_empaque: fechaEmpaque,
                origen: 'conversion_granel',
              });
            }
          }
          return extra;
        };

        let formExtraDesv: LineaProduccion[] = [];
        let formExtraConv: LineaProduccion[] = [];
        try {
          formExtraDesv = flushFormDesv();
          formExtraConv = flushFormConv();
        } catch (e: any) {
          return alert(e?.message || String(e));
        }

        const prodDesv = [
          ...lineasProduccion.filter((l) => l.origen === 'desverdizado'),
          ...formExtraDesv,
        ];
        const prodConv = [
          ...lineasProduccion.filter((l) => l.origen === 'conversion_granel'),
          ...formExtraConv,
        ].filter(
          (p) => p.presentacion !== 'rpc_granel' && p.presentacion !== 'bins_jugo'
        );

        const haceDesv = consumosDesverdizado.length > 0;
        const haceConv = consumosGranel.length > 0;

        if (!haceDesv && !haceConv) {
          return alert(
            'Agrega consumos de desverdizado y/o de RPC a granel (puedes capturar ambos sin borrar al cambiar de pestaña).'
          );
        }
        if (haceDesv && prodDesv.length === 0) {
          return alert(
            'Tienes bins de desverdizado: agrega producción (RPC/cartón/granel/jugo) desde la pestaña 1.'
          );
        }
        if (haceConv && prodConv.length === 0) {
          return alert(
            'Tienes consumo de granel: agrega producción final (RPC 12/18 o cartón) en la pestaña 2.'
          );
        }
        for (const p of prodDesv) {
          if (p.presentacion === 'rpc_granel' && !p.lote) {
            return alert('Cada línea de RPC a granel debe tener lote de origen');
          }
        }
        if (haceConv) {
          for (const c of consumosGranel) {
            if (!c.lote) {
              return alert('Cada consumo de granel debe tener lote de origen');
            }
            if (!c.fecha_empaque) {
              return alert(
                'Cada consumo de granel debe tener la fecha del día en que se empacó'
              );
            }
            const key = granelKey(c.talla, c.lote, c.fecha_empaque);
            const row = stockGranelRows.find((r) => r.rowKey === key);
            const stock = row?.cantidad || 0;
            const yaOtros = consumosGranel
              .filter(
                (x) => x !== c && granelKey(x.talla, x.lote, x.fecha_empaque) === key
              )
              .reduce((s, x) => s + x.cantidad, 0);
            if (c.cantidad + yaOtros > stock) {
              return alert(
                `Stock insuficiente granel lote ${c.lote} #${c.talla || 's/t'} (${c.fecha_empaque}): hay ${stock}`
              );
            }
          }
        }

        const mensajes: string[] = [];

        // 1) Empaque desde desverdizado (no pierde datos al haber capturado también granel)
        if (haceDesv) {
          payload.consumos_desverdizado = consumosDesverdizado;
          payload.produccion = prodDesv.map(({ origen: _o, ...rest }) => rest);
          payload.cantidad_cajas_campo_usadas = 0;
          payload.cantidad_cajas_carton_producidas = 0;
          await createEmpaqueMutation.mutateAsync(payload);
          mensajes.push('Empaque desde desverdizado registrado');
        }

        // 2) Conversión granel → final (independiente; conserva captura de bins)
        if (haceConv) {
          setConvirtiendo(true);
          try {
            const res = await convertirRpcGranel(token, {
              mercado: mercadoEmpaque,
              fecha: fechaEmpaque,
              consumos_granel: consumosGranel.map((c) => ({
                talla: c.talla,
                lote: c.lote,
                fecha_empaque: c.fecha_empaque,
                cantidad: c.cantidad,
              })),
              produccion: prodConv.map(({ origen: _o, ...rest }) => rest),
              numero_empacador: 'EMP-01',
            });
            mensajes.push(res.message || 'Conversión de granel registrada');
          } finally {
            setConvirtiendo(false);
          }
        }

        alert(`✅ ${mensajes.join('\n')}`);
        setCajasCampoUsadas('');
        setCajasCartonProducidas('');
        setVariedadEmpaque('');
        setMercadoEmpaque('nacional');
        setFechaEmpaque(todayInputDate());
        setConsumosDesverdizado([]);
        setLoteProduccionGranel('');
        setSelectedDesv(null);
        setSelectedBinsToUse('');
        setConsumosGranel([]);
        setSelectedGranelKey('');
        setSelectedGranelCant('');
        setLineasProduccion([]);
        setProdPresentacion('');
        resetLimonProduccionForm();
        onEmpaqueRegistered();
        cargarDesverdizado();
        return;
      }

      await createEmpaqueMutation.mutateAsync(payload);
      alert('✅ Empaque registrado');
      setCajasCampoUsadas('');
      setCajasCartonProducidas('');
      setVariedadEmpaque('');
      setMercadoEmpaque('nacional');
      setFechaEmpaque(todayInputDate());
      setConsumosDesverdizado([]);
      setLoteProduccionGranel('');
      setSelectedDesv(null);
      setSelectedBinsToUse('');
      setConsumosGranel([]);
      setSelectedGranelKey('');
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
          setSelectedDesv(null);
          setSelectedBinsToUse('');
          setLineasProduccion([]);
          setProdPresentacion('');
          setFechaEmpaque(todayInputDate());
          resetLimonProduccionForm();
        }}
        style={{ width: '100%', padding: 12, margin: '8px 0' }}
      >
        <option value="">Seleccionar producto</option>
        <option value="uva">Uva</option>
        <option value="limon_amarillo">Limón Amarillo</option>
      </select>

      {productoEmpaque && (
        <label style={{ display: 'block', margin: '8px 0', fontSize: 14 }}>
          <span style={{ fontWeight: 600, color: '#0f172a' }}>
            Fecha de empaque *
          </span>
          <input
            type="date"
            required
            value={fechaEmpaque}
            onChange={(e) => setFechaEmpaque(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              maxWidth: 220,
              padding: 10,
              marginTop: 4,
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              background: 'white',
              color: '#0f172a',
            }}
          />
        </label>
      )}

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
                // Solo cambia pestaña: NO borra consumos ni producción capturada
                setModoLimon('desverdizado');
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
                // Solo cambia pestaña: conserva bins y producción de desverdizado
                setModoLimon('granel');
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
          {(consumosDesverdizado.length > 0 ||
            consumosGranel.length > 0 ||
            lineasProduccion.length > 0) && (
            <p
              style={{
                fontSize: 12,
                color: '#166534',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                padding: '8px 12px',
                margin: '0 0 12px',
              }}
            >
              Puedes capturar <strong>ambos</strong> flujos: al cambiar de pestaña no se borra lo
              ya agregado.
              {consumosDesverdizado.length > 0 && (
                <> · Bins desverdizado: {consumosDesverdizado.length} lote(s)</>
              )}
              {consumosGranel.length > 0 && (
                <> · Consumos granel: {consumosGranel.length}</>
              )}
              {lineasProduccion.length > 0 && (
                <> · Líneas producción: {lineasProduccion.length}</>
              )}
            </p>
          )}

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
                Selecciona <strong>fecha de empaque + lote + talla</strong>. Cada día de
                empaque es un registro aparte (no se mezcla con corridas anteriores).
              </p>
              {stockGranelRows.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13 }}>
                  No hay RPC a granel en inventario. Primero empaca desde desverdizado.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                  {stockGranelRows.map((row) => (
                    <div
                      key={row.rowKey}
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
                          {row.fecha_empaque
                            ? formatFechaCorta(row.fecha_empaque)
                            : 's/fecha'}
                        </strong>
                        {' · '}
                        Lote {row.lote || 's/lote'}
                        {' · '}#{row.talla || 's/talla'}
                        {' · '}
                        Disp: {stockDisponibleGranel(row.rowKey)} / {row.cantidad}
                        {' · '}
                        {(KG_POR_PRESENTACION.rpc_granel || 22) * row.cantidad} kg
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedGranelKey(row.rowKey)}
                        style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}
                      >
                        Seleccionar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedGranelKey && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13 }}>
                    {(() => {
                      const r = stockGranelRows.find((x) => x.rowKey === selectedGranelKey);
                      return (
                        <>
                          <strong>
                            {r?.fecha_empaque
                              ? formatFechaCorta(r.fecha_empaque)
                              : 's/fecha'}
                          </strong>
                          {' · '}
                          Lote <strong>{r?.lote || 's/lote'}</strong> · #
                          <strong>{r?.talla || 's/t'}</strong>
                        </>
                      );
                    })()}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={stockDisponibleGranel(selectedGranelKey)}
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
                      const disp = stockDisponibleGranel(selectedGranelKey);
                      const row = stockGranelRows.find((r) => r.rowKey === selectedGranelKey);
                      if (cant <= 0) return alert('Cantidad debe ser > 0');
                      if (cant > disp) {
                        return alert(`Solo hay ${disp} disponibles de esa corrida`);
                      }
                      if (!row?.lote) {
                        return alert('Este granel no tiene lote de origen');
                      }
                      if (!row.fecha_empaque) {
                        return alert(
                          'Este granel no tiene fecha de empaque (corrida antigua). ' +
                            'Si necesitas usarlo, contacta admin o re-registra el granel con fecha.'
                        );
                      }
                      setConsumosGranel([
                        ...consumosGranel,
                        {
                          talla: row.talla,
                          lote: row.lote,
                          fecha_empaque: row.fecha_empaque,
                          cantidad: cant,
                        },
                      ]);
                      setSelectedGranelCant('');
                      setSelectedGranelKey('');
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
                      {c.fecha_empaque ? formatFechaCorta(c.fecha_empaque) : '?'} {c.lote} #
                      {c.talla || 's/t'}:{c.cantidad}{' '}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                  <strong>Inventario Desverdizado (bins de {PESO_BIN_CAMPO_KG} kg):</strong>
                  <span
                    style={{
                      fontWeight: 800,
                      color: '#0c4a6e',
                      background: '#e0f2fe',
                      padding: '2px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    Total:{' '}
                    {desverdizadoList.reduce(
                      (s: number, d: any) => s + (d.cantidad_bins_disponibles || 0),
                      0
                    )}{' '}
                    bins
                  </span>
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
                {desverdizadoList.map((d: any) => {
                  const isSel =
                    selectedDesv &&
                    selectedDesv.lote === d.lote &&
                    String(selectedDesv.fecha_recepcion || '') ===
                      String(d.fecha_recepcion || '') &&
                    (selectedDesv.id == null || selectedDesv.id === d.id);
                  return (
                    <div
                      key={d.id ?? `${d.lote}-${d.fecha_recepcion}`}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        margin: '4px 0',
                        fontSize: 13,
                        padding: '6px 8px',
                        background: isSel ? '#f0fdf4' : '#f8fafc',
                        borderRadius: 6,
                        border: isSel ? '2px solid #15803d' : '1px solid #e2e8f0',
                      }}
                    >
                      <span style={{ flex: 1 }}>
                        Lote: <strong>{d.lote}</strong> —{' '}
                        <strong style={{ color: '#14532d' }}>
                          {d.cantidad_bins_disponibles} bins
                        </strong>{' '}
                        | Corte: {formatFechaCorta(d.fecha_recepcion)} | {d.estado}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDesv({
                            id: d.id,
                            lote: d.lote,
                            fecha_recepcion: d.fecha_recepcion || null,
                            disponible: d.cantidad_bins_disponibles || 0,
                          })
                        }
                        style={{ padding: '2px 8px', fontSize: 12 }}
                      >
                        Seleccionar
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedDesv && (
                <div style={{ display: 'flex', gap: 8, margin: '4px 0', alignItems: 'center' }}>
                  <span>
                    Lote: <strong>{selectedDesv.lote}</strong>
                    {selectedDesv.fecha_recepcion
                      ? ` · Corte ${formatFechaCorta(selectedDesv.fecha_recepcion)}`
                      : ''}{' '}
                    (máx {selectedDesv.disponible})
                  </span>
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
                      if (binsNum <= 0) return;
                      if (binsNum > selectedDesv.disponible) {
                        return alert(
                          `Solo hay ${selectedDesv.disponible} bins de ${selectedDesv.lote}` +
                            (selectedDesv.fecha_recepcion
                              ? ` (corte ${selectedDesv.fecha_recepcion})`
                              : '')
                        );
                      }
                      setConsumosDesverdizado([
                        ...consumosDesverdizado,
                        {
                          lote: selectedDesv.lote,
                          bins: binsNum,
                          // Clave para anular/devolver al corte correcto
                          fecha_recepcion: selectedDesv.fecha_recepcion || undefined,
                        },
                      ]);
                      setSelectedBinsToUse('');
                      setSelectedDesv(null);
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
                      {c.lote}
                      {c.fecha_recepcion
                        ? `@${String(c.fecha_recepcion).slice(0, 10)}`
                        : ''}
                      :{c.bins}{' '}
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
                  Flujo: lavado → <strong>RPC a granel 22 kg por talla y lote</strong> y/o final;
                  2da = bins jugo. El granel conserva el lote de campo. RPC final: tallas 140+ ·
                  Cartón: 75–200 (incluye 165 y 200).
                </>
              ) : (
                <>
                  Con los consumos de granel (lote + talla), produce <strong>RPC 12 / 18</strong>{' '}
                  o <strong>cartón</strong>. El lote se hereda al producto final.
                </>
              )}
            </p>

            {modoLimon === 'desverdizado' &&
              prodPresentacion === 'rpc_granel' &&
              lotesEnConsumo.length > 1 && (
                <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Lote de origen del granel *</span>
                  <select
                    value={loteProduccionGranel}
                    onChange={(e) => setLoteProduccionGranel(e.target.value)}
                    style={{
                      display: 'block',
                      marginTop: 4,
                      padding: 8,
                      minWidth: 200,
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      background: 'white',
                      color: '#0f172a',
                    }}
                  >
                    <option value="">— Selecciona lote —</option>
                    {lotesEnConsumo.map((lo) => (
                      <option key={lo} value={lo}>
                        {lo}
                      </option>
                    ))}
                  </select>
                </label>
              )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(modoLimon === 'desverdizado'
                ? ([
                    {
                      value: 'rpc_granel',
                      label: 'RPC a granel',
                      hint: '22 kg · talla + lote',
                    },
                    { value: 'rpc_18', label: 'RPC 18', hint: 'tallas 140+' },
                    { value: 'rpc_12', label: 'RPC 12', hint: 'tallas 140+' },
                    { value: 'caja_40lbs', label: 'Cartón 40 lbs', hint: 'tallas 75–200' },
                    { value: 'bins_jugo', label: 'Bins jugo (2da)', hint: '900 kg' },
                  ] as const)
                : ([
                    { value: 'rpc_18', label: 'RPC 18', hint: 'tallas 140+' },
                    { value: 'rpc_12', label: 'RPC 12', hint: 'tallas 140+' },
                    { value: 'caja_40lbs', label: 'Cartón 40 lbs', hint: 'tallas 75–200' },
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
                {(tallasActivas.includes('140') ||
                  tallasActivas.includes('165') ||
                  tallasActivas.includes('200')) &&
                  (esPresentacionCarton(prodPresentacion) ||
                    esPresentacionRpc(prodPresentacion)) && (
                  <p style={{ fontSize: 11, color: '#b45309', margin: '8px 0 0' }}>
                    * Tallas 140 / 165 / 200: válidas en RPC y en cartón (elige la presentación
                    correcta arriba).
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
              <strong>Producción agregada (se conserva al cambiar de pestaña):</strong>
              <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
                {lineasProduccion.map((l, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        marginRight: 6,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background:
                          l.origen === 'conversion_granel' ? '#e0f2fe' : '#dcfce7',
                        color: '#0f172a',
                      }}
                    >
                      {l.origen === 'conversion_granel' ? 'desde granel' : 'desde bins'}
                    </span>
                    {labelPresentacion(l.presentacion)}
                    {l.talla ? ` #${l.talla}` : ''}
                    {l.lote ? ` · lote ${l.lote}` : ''}
                    {l.fecha_empaque
                      ? ` · emp. ${formatFechaCorta(l.fecha_empaque)}`
                      : ''}{' '}
                    × {l.cantidad}
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
