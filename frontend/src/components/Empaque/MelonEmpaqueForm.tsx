import { useState, type CSSProperties } from 'react';
import {
  FILAS_CAJA_MELON,
  cajasPorParrillaMelon,
  labelCalidadMelon,
  labelPresentacionMelon,
  type CalidadMelon,
  type TipoCajaMelon,
} from '../../lib/constants';
import { formatFechaCorta } from '../../lib/dates';

export type LineaMelon = {
  presentacion: TipoCajaMelon;
  talla: string;
  /** Parrillas / pallets completos capturados en empaque */
  cantidad: number;
  calidad: CalidadMelon;
  /** Cajas por parrilla (56 chica/normal, 49 jumbo) */
  cajas_por_parrilla: number;
};

export type BinMelonDisponible = {
  id?: number;
  lote: string;
  cantidad_bins_disponibles: number;
  fecha_recepcion?: string | null;
  estado?: string;
};

export type ConsumoMelon = {
  lote: string;
  bins: number;
  fecha_recepcion?: string | null;
};

export type LoteMelonLigado = {
  lote: string;
  consumos: ConsumoMelon[];
  lineas: LineaMelon[];
};

type Props = {
  fechaEmpaque: string;
  lineas: LineaMelon[];
  onChangeLineas: (lineas: LineaMelon[]) => void;
  binsDisponibles: BinMelonDisponible[];
  consumos: ConsumoMelon[];
  onChangeConsumos: (consumos: ConsumoMelon[]) => void;
  onRefreshBins?: () => void;
  /** Bins ya ligados en lotes pendientes (restan del disponible mostrado). */
  binsReservados?: ConsumoMelon[];
  /** Lotes ligados esperando el Registrar Empaque final. */
  lotesLigados?: LoteMelonLigado[];
  onQuitarLoteLigado?: (idx: number) => void;
};

type QtyMap = Record<string, string>;

function keyOf(calidad: CalidadMelon, presentacion: string, talla: string) {
  return `${calidad}|${presentacion}|${talla}`;
}

export default function MelonEmpaqueForm({
  fechaEmpaque,
  lineas,
  onChangeLineas,
  binsDisponibles,
  consumos,
  onChangeConsumos,
  onRefreshBins,
  binsReservados = [],
  lotesLigados = [],
  onQuitarLoteLigado,
}: Props) {
  const [qty, setQty] = useState<QtyMap>({});
  /** Cantidad a jalar por fila de stock (misma clave que stockKey). */
  const [qtyBinsPorFila, setQtyBinsPorFila] = useState<Record<string, string>>({});

  const setCell = (calidad: CalidadMelon, presentacion: string, talla: string, v: string) => {
    setQty((prev) => ({ ...prev, [keyOf(calidad, presentacion, talla)]: v }));
  };

  const stockKey = (d: BinMelonDisponible) =>
    `${d.lote}|${String(d.fecha_recepcion || '').slice(0, 10)}|${d.id ?? ''}`;

  const binsUsadosMismaFila = (d: BinMelonDisponible, lista: ConsumoMelon[]) =>
    lista
      .filter(
        (c) =>
          c.lote === d.lote &&
          String(c.fecha_recepcion || '').slice(0, 10) ===
            String(d.fecha_recepcion || '').slice(0, 10)
      )
      .reduce((s, c) => s + c.bins, 0);

  const disponibleNeto = (d: BinMelonDisponible) => {
    const ya =
      binsUsadosMismaFila(d, consumos) + binsUsadosMismaFila(d, binsReservados);
    return Math.max(0, (d.cantidad_bins_disponibles || 0) - ya);
  };

  /** En melón no se mezclan lotes: un solo lote (sección) por empaque. */
  const loteActivo = consumos.length > 0 ? String(consumos[0].lote || '').trim() : '';

  const agregarConsumoFila = (d: BinMelonDisponible) => {
    const k = stockKey(d);
    const disp = disponibleNeto(d);
    const n = parseInt(qtyBinsPorFila[k] || '', 10) || 0;
    if (n <= 0) return alert('Indica cuántos bins jalar');
    if (n > disp) {
      return alert(
        `Solo hay ${disp} bins disponibles de ${d.lote}` +
          (d.fecha_recepcion ? ` (corte ${formatFechaCorta(d.fecha_recepcion)})` : '')
      );
    }
    const loteNuevo = String(d.lote || '').trim();
    if (loteActivo && loteActivo !== loteNuevo) {
      return alert(
        `En melón no se mezclan lotes. Este empaque ya usa «${loteActivo}». ` +
          `Regístralo (o «Registrar otro lote») y luego captura «${loteNuevo}» por separado.`
      );
    }
    // Mismo lote: acumular bins en una sola línea de consumo
    const fr = d.fecha_recepcion ? String(d.fecha_recepcion).slice(0, 10) : undefined;
    const idx = consumos.findIndex(
      (c) =>
        c.lote === d.lote &&
        String(c.fecha_recepcion || '').slice(0, 10) === String(fr || '')
    );
    if (idx >= 0) {
      const next = consumos.map((c, i) =>
        i === idx ? { ...c, bins: c.bins + n } : c
      );
      onChangeConsumos(next);
    } else {
      onChangeConsumos([
        ...consumos,
        { lote: d.lote, bins: n, fecha_recepcion: fr },
      ]);
    }
    setQtyBinsPorFila((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const totalBinsConsumo = consumos.reduce((s, c) => s + c.bins, 0);

  const agregarGrupo = (calidad: CalidadMelon) => {
    const nuevas: LineaMelon[] = [];
    for (const fila of FILAS_CAJA_MELON) {
      for (const t of fila.tallas) {
        const n = parseInt(qty[keyOf(calidad, fila.presentacion, t)] || '', 10) || 0;
        if (n > 0) {
          nuevas.push({
            presentacion: fila.presentacion,
            talla: t,
            cantidad: n,
            calidad,
            cajas_por_parrilla: cajasPorParrillaMelon(fila.presentacion),
          });
        }
      }
    }
    if (nuevas.length === 0) {
      return alert(
        `Llena al menos una talla en ${labelCalidadMelon(calidad)} con cantidad > 0`
      );
    }
    onChangeLineas([...lineas, ...nuevas]);
    setQty((prev) => {
      const next = { ...prev };
      for (const fila of FILAS_CAJA_MELON) {
        for (const t of fila.tallas) {
          delete next[keyOf(calidad, fila.presentacion, t)];
        }
      }
      return next;
    });
  };

  const renderGrupo = (calidad: CalidadMelon) => {
    const esLlano = calidad === 'llano';
    const wrapStyle: CSSProperties = esLlano
      ? {
          border: '2px solid #7dd3fc',
          background: '#f0f9ff',
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
        }
      : {
          border: '2px solid #a16207',
          background: '#fffbeb',
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
        };

    return (
      <div key={calidad} style={wrapStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                color: esLlano ? '#0c4a6e' : '#78350f',
                letterSpacing: 0.3,
              }}
            >
              {esLlano ? 'Primera “LLANO”' : 'Segunda “Wallys”'}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {esLlano
                ? '1ra calidad — Chica A → Normal B → Jumbo C (en horizontal)'
                : '2da calidad — mismas cajas en horizontal (tonos café lavados)'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => agregarGrupo(calidad)}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: esLlano ? '#0284c7' : '#92400e',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Agregar {esLlano ? 'LLANO' : 'Wallys'}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 12,
            alignItems: 'stretch',
          }}
        >
          {FILAS_CAJA_MELON.map((fila) => {
            const pal = esLlano ? fila.llano : fila.wallys;
            return (
              <div
                key={`${calidad}-${fila.presentacion}`}
                style={{
                  background: pal.rowBg,
                  border: `1.5px solid ${pal.border}`,
                  borderRadius: 10,
                  padding: '12px 10px',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 13,
                    color: pal.title,
                    marginBottom: 4,
                    textAlign: 'center',
                  }}
                >
                  {fila.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#64748b',
                    textAlign: 'center',
                    marginBottom: 10,
                    fontWeight: 600,
                  }}
                >
                  {cajasPorParrillaMelon(fila.presentacion)} cajas / parrilla
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 8,
                  }}
                >
                  {fila.tallas.map((t) => {
                    const k = keyOf(calidad, fila.presentacion, t);
                    return (
                      <label
                        key={k}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          background: pal.cellBg,
                          border: `1px solid ${pal.border}`,
                          borderRadius: 8,
                          padding: '8px 6px',
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: pal.title,
                            textAlign: 'center',
                          }}
                        >
                          #{t}s
                        </span>
                        <input
                          type="number"
                          min={0}
                          placeholder="parr."
                          title="Parrillas / pallets completos"
                          value={qty[k] || ''}
                          onChange={(e) =>
                            setCell(calidad, fila.presentacion, t, e.target.value)
                          }
                          style={{
                            width: '100%',
                            padding: '6px 4px',
                            border: '1px solid #cbd5e1',
                            borderRadius: 6,
                            textAlign: 'center',
                            fontWeight: 700,
                            background: '#fff',
                          }}
                        />
                        {!!(parseInt(qty[k] || '', 10) || 0) && (
                          <span
                            style={{
                              fontSize: 10,
                              color: '#64748b',
                              textAlign: 'center',
                              lineHeight: 1.2,
                            }}
                          >
                            ={' '}
                            {(parseInt(qty[k] || '', 10) || 0) *
                              cajasPorParrillaMelon(fila.presentacion)}{' '}
                            cajas
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #86efac',
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
          fontSize: 13,
          color: '#14532d',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <strong>Bins de campo por sección (obligatorio)</strong>
          {onRefreshBins && (
            <button
              type="button"
              onClick={onRefreshBins}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #86efac',
                background: '#fff',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Actualizar stock
            </button>
          )}
        </div>
        <div style={{ marginBottom: 8, color: '#334155', fontSize: 12 }}>
          Fecha de empaque: <strong>{fechaEmpaque || '—'}</strong> · Solo bins de{' '}
          <strong>melón</strong>. Un lote a la vez: liga con «Registrar otro lote» (verde) y al
          terminar pulsa «Registrar Empaque» (azul).
        </div>

        {lotesLigados.length > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              background: '#ecfdf5',
              border: '1px solid #6ee7b7',
              borderRadius: 8,
              fontSize: 13,
              color: '#065f46',
            }}
          >
            <strong>
              Lotes ligados ({lotesLigados.length}) — pendientes de Registrar Empaque
            </strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {lotesLigados.map((lig, i) => {
                const bins = lig.consumos.reduce((s, c) => s + c.bins, 0);
                const parr = lig.lineas.reduce((s, l) => s + (l.cantidad || 0), 0);
                return (
                  <li key={`${lig.lote}-${i}`} style={{ marginBottom: 4 }}>
                    <strong>{lig.lote}</strong> · {bins} bins · {parr} parr. ·{' '}
                    {lig.lineas.length} línea(s)
                    {onQuitarLoteLigado && (
                      <button
                        type="button"
                        onClick={() => onQuitarLoteLigado(i)}
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: '#b91c1c',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        Quitar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div style={{ marginTop: 6, fontSize: 12, color: '#047857' }}>
              Introduce bins disponibles de otro lote y su producción abajo.
            </div>
          </div>
        )}

        {loteActivo && (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              background: '#dcfce7',
              border: '1px solid #86efac',
              borderRadius: 8,
              fontSize: 12,
              color: '#14532d',
              fontWeight: 600,
            }}
          >
            Lote en captura ahora: <strong>{loteActivo}</strong> · {totalBinsConsumo} bins
          </div>
        )}

        {binsDisponibles.length === 0 ? (
          <div style={{ color: '#92400e', background: '#fffbeb', padding: 10, borderRadius: 8 }}>
            No hay bins de melón disponibles. Registra recepción de melón primero.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginBottom: 10,
            }}
          >
            {binsDisponibles.map((d) => {
              const k = stockKey(d);
              const disp = disponibleNeto(d);
              const mismoLote = !loteActivo || loteActivo === String(d.lote || '').trim();
              const bloqueado = !mismoLote;
              const agotado = disp <= 0 || bloqueado;
              return (
                <div
                  key={k}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) 88px 96px',
                    alignItems: 'center',
                    columnGap: 16,
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: mismoLote && loteActivo ? '2px solid #15803d' : '1px solid #cbd5e1',
                    background: bloqueado ? '#f8fafc' : agotado ? '#f1f5f9' : '#fff',
                    opacity: bloqueado ? 0.45 : agotado ? 0.55 : 1,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 800,
                        color: '#14532d',
                        fontSize: 14,
                        lineHeight: 1.3,
                        wordBreak: 'break-word',
                      }}
                    >
                      {d.lote}
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                      <strong>{disp}</strong> bins disp.
                      {d.fecha_recepcion
                        ? ` · Corte ${formatFechaCorta(d.fecha_recepcion)}`
                        : ''}
                      {bloqueado ? ' · otro lote (bloqueado)' : ''}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={disp}
                    disabled={agotado}
                    placeholder="Cant."
                    title={
                      bloqueado
                        ? 'Registra el lote activo antes de usar otro'
                        : `Bins a jalar (máx. ${disp})`
                    }
                    value={qtyBinsPorFila[k] || ''}
                    onChange={(e) =>
                      setQtyBinsPorFila((prev) => ({ ...prev, [k]: e.target.value }))
                    }
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      textAlign: 'center',
                      fontWeight: 700,
                      background: agotado ? '#e2e8f0' : '#fff',
                    }}
                  />
                  <button
                    type="button"
                    disabled={agotado}
                    onClick={() => agregarConsumoFila(d)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: agotado ? '#94a3b8' : '#15803d',
                      color: '#fff',
                      fontWeight: 700,
                      cursor: agotado ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    + Agregar
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {consumos.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <strong>Consumos ({totalBinsConsumo} bins)</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {consumos.map((c, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {c.lote}
                  {c.fecha_recepcion
                    ? `@${String(c.fecha_recepcion).slice(0, 10)}`
                    : ''}
                  : <strong>{c.bins}</strong>{' '}
                  <button
                    type="button"
                    onClick={() => onChangeConsumos(consumos.filter((_, j) => j !== i))}
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      color: '#b91c1c',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
          fontSize: 12,
          color: '#334155',
        }}
      >
        Captura en <strong>parrillas / pallets</strong> completos — Chica y Normal ={' '}
        <strong>56 cajas</strong>/parr. · Jumbo = <strong>49 cajas</strong>/parr. En reportes el
        resumen irá por <strong>cajas empacadas</strong>.
      </div>

      {renderGrupo('llano')}
      {renderGrupo('wallys')}

      {lineas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong>Producción capturada ({lineas.length})</strong>
          <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 13 }}>
            {lineas.map((l, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {labelCalidadMelon(l.calidad)} · {labelPresentacionMelon(l.presentacion)} · #
                {l.talla}s:{' '}
                <strong>
                  {l.cantidad} parr. (
                  {l.cantidad *
                    (l.cajas_por_parrilla || cajasPorParrillaMelon(l.presentacion))}{' '}
                  cajas)
                </strong>{' '}
                <button
                  type="button"
                  onClick={() => onChangeLineas(lineas.filter((_, j) => j !== i))}
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    color: '#b91c1c',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
