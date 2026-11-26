import type { CSSProperties } from 'react';
import type { ReporteCatalogo } from '../../lib/catalogoApi';
import {
  indicadoresDesdeReporte,
  textoDesgloseCajasCampo,
  textoDetalleBins,
  textoDetalleCajasCampo,
  textoDetalleParrilla,
  textoKgBin,
  textoKilosDeApoyo,
  textoNotaHectareas,
  textoPorcentaje,
  textoSubtituloTolva,
  textoRendimiento,
  textoTonHa,
} from './picososKpi';
import './picososIndicadores.css';

const cardBase: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: 2,
  padding: '8px 10px',
};

const labelStyle: CSSProperties = {
  fontWeight: 700,
  letterSpacing: 0.2,
  textTransform: 'uppercase',
};

const valueStyle: CSSProperties = {
  fontWeight: 800,
  letterSpacing: -0.4,
  marginTop: 2,
};

/**
 * Las seis tarjetas del reporte de un picoso o de tomatillo. Mismo alto, 3 columnas × 2 filas.
 * Tomatillo cambia la unidad (caja de campo); los picosos siguen en bins.
 * No agrega otros KPI: filtros y la gráfica quedan en el reporte de catálogo.
 */
export default function PicososTablero({ data }: { data: ReporteCatalogo }) {
  const ind = indicadoresDesdeReporte(data);
  const caja = ind.unidad === 'cajas_campo';
  const hayEmpaque = ind.kgConsumido > 0;
  const subTolva = textoSubtituloTolva(ind);
  const desglose = textoDesgloseCajasCampo(ind);

  return (
    <div className="picosos-kpi-grid" style={{ marginBottom: 4 }}>
      <Tarjeta
        fondo="#dbeafe"
        tinta="#1e40af"
        valorColor="#1e3a8a"
        titulo="% empacado en primera"
        valor={textoPorcentaje(ind.pctPrimera)}
        sufijo={ind.pctPrimera != null ? '%' : undefined}
        pie={hayEmpaque ? textoKilosDeApoyo(ind.kgPrimera) : 'Sin empaque en el periodo'}
        title={
          hayEmpaque
            ? `${ind.kgPrimera} kg de primera / ${ind.kgConsumido} kg de campo consumidos`
            : 'Sin kilos de campo consumidos por empaque'
        }
      />
      <Tarjeta
        fondo="#fef9c3"
        tinta="#854d0e"
        valorColor="#713f12"
        titulo="% de segunda"
        valor={textoPorcentaje(ind.pctSegunda)}
        sufijo={ind.pctSegunda != null ? '%' : undefined}
        pie={hayEmpaque ? textoKilosDeApoyo(ind.kgSegunda) : 'Sin empaque en el periodo'}
        title={
          hayEmpaque
            ? `${ind.kgSegunda} kg de segunda / ${ind.kgConsumido} kg de campo consumidos`
            : 'Sin kilos de campo consumidos por empaque'
        }
      />
      <Tarjeta
        fondo="#e0f2fe"
        tinta="#075985"
        valorColor="#0c4a6e"
        titulo={caja ? 'Cajas de campo por parrilla' : 'Bins por parrilla'}
        valor={textoRendimiento(ind.binsPorParrilla)}
        pie={textoDetalleParrilla(ind)}
        nota={desglose ?? undefined}
        title={
          caja
            ? ind.binsPorParrilla != null
              ? `${ind.binsConsumidos} cajas de campo eq. / ${ind.parrillas} parrillas (1ra + 2da)${desglose ? ` · ${desglose}` : ''}`
              : 'Cajas de campo equivalentes entre parrillas de primera y de segunda'
            : ind.binsPorParrilla != null
              ? `${ind.binsConsumidos} bins / ${ind.parrillas} parrillas (1ra + 2da)`
              : 'Bins consumidos entre parrillas de primera y de segunda'
        }
      />
      <Tarjeta
        fondo="#f0fdf4"
        tinta="#166534"
        valorColor="#14532d"
        titulo="Toneladas por hectárea"
        valor={textoTonHa(ind.tonPorHa)}
        pie={textoNotaHectareas(ind)}
        title={
          ind.hectareasReservadas
            ? 'Hectáreas por cultivo en desarrollo'
            : ind.tonPorHa != null
              ? `${ind.toneladasEmpacadas} t / ${ind.hectareas} ha`
              : 'Hay hectáreas, pero este periodo no tiene toneladas empacadas'
        }
      />
      <Tarjeta
        fondo="#fff7ed"
        tinta="#9a3412"
        valorColor="#7c2d12"
        titulo={caja ? 'Kg efectivos por caja de campo' : 'Kg efectivos por bin'}
        valor={textoKgBin(ind.kgEfectivosPorBin)}
        sufijo={ind.kgEfectivosPorBin != null ? (caja ? 'kg/caja' : 'kg/bin') : undefined}
        pie={caja ? textoDetalleCajasCampo(ind.binsConsumidos) : textoDetalleBins(ind.binsConsumidos)}
        title={
          caja
            ? ind.kgEfectivosPorBin != null
              ? `(${ind.kgPrimera} + ${ind.kgSegunda}) kg / ${ind.binsConsumidos} cajas de campo eq.`
              : 'Primera y segunda entre cajas de campo equivalentes'
            : ind.kgEfectivosPorBin != null
              ? `(${ind.kgPrimera} + ${ind.kgSegunda}) kg / ${ind.binsConsumidos} bins`
              : 'Primera y segunda entre bins de campo consumidos'
        }
      />
      <Tarjeta
        fondo="#f8fafc"
        tinta="#334155"
        valorColor="#0f172a"
        titulo="Producto de tolva"
        valor={textoPorcentaje(ind.tolvaPorcentaje)}
        sufijo={ind.tolvaPorcentaje != null ? '%' : undefined}
        pie={subTolva.kilos ?? subTolva.bin}
        nota={subTolva.kilos ? subTolva.bin : undefined}
        title={
          ind.tolvaPorcentaje != null
            ? caja
              ? `${ind.tolvaPorBin} kg/caja / ${ind.pesoTeoricoBinKg} kg de la caja de campo`
              : `${ind.tolvaPorBin} kg/bin / ${ind.pesoTeoricoBinKg} kg del bin`
            : subTolva.bin
        }
      />
    </div>
  );
}

function Tarjeta({
  fondo,
  tinta,
  valorColor,
  titulo,
  valor,
  sufijo,
  pie,
  nota,
  title,
}: {
  fondo: string;
  tinta: string;
  valorColor: string;
  titulo: string;
  valor: string;
  sufijo?: string;
  pie: string;
  nota?: string;
  title?: string;
}) {
  return (
    <div className="picosos-kpi-card" style={{ ...cardBase, background: fondo }} title={title}>
      <div className="picosos-kpi-label" style={{ ...labelStyle, color: tinta }}>
        {titulo}
      </div>
      <div className="picosos-kpi-num picosos-kpi-value" style={{ ...valueStyle, color: valorColor }}>
        {valor}
        {sufijo && (
          <span style={{ fontSize: 14, fontWeight: 700, marginLeft: sufijo === '%' ? 1 : 4 }}>
            {sufijo}
          </span>
        )}
      </div>
      <div className="picosos-kpi-num picosos-kpi-foot" style={{ color: tinta }}>
        {pie}
      </div>
      {nota && (
        <div className="picosos-kpi-num picosos-kpi-foot" style={{ color: tinta }}>
          {nota}
        </div>
      )}
    </div>
  );
}
