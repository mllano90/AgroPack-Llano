import type { InventarioFinalItem } from '../../types';

interface InventarioFinalSelectorProps {
  inventario: InventarioFinalItem[];
  value: InventarioFinalItem | null;
  onChange: (item: InventarioFinalItem | null) => void;
  style?: React.CSSProperties;
  emptyLabel?: string;
  disabled?: boolean;
  minWidth?: string;
  className?: string;
}

/**
 * Advanced selector for Inventario Final.
 * Shows Variedad + Tipo de Cultivo + Mercado + Stock.
 * Only displays items with stock > 0 by default.
 */
export default function InventarioFinalSelector({
  inventario,
  value,
  onChange,
  style,
  emptyLabel = 'Seleccionar del Inventario Final',
  disabled = false,
  minWidth = '320px',
  className,
}: InventarioFinalSelectorProps) {
  const defaultStyle: React.CSSProperties = {
    padding: '10px',
    flex: 2,
    minWidth,
  };

  const mergedStyle = { ...defaultStyle, ...style };

  const getValueKey = (item: InventarioFinalItem) => {
    if (item.presentacion) {
      return `limon-${item.presentacion}-${item.talla || ''}-${item.mercado}`;
    }
    return `${item.variedad || ''}-${item.tipo_cultivo || ''}-${item.mercado}`;
  };

  const selectedKey = value ? getValueKey(value) : '';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    if (!key) {
      onChange(null);
      return;
    }

    const found = inventario.find((item) => getValueKey(item) === key);
    onChange(found || null);
  };

  // Filter + sort for better UX (support both uva and limón)
  const itemsConStock = inventario
    .filter((item) => item.cantidad_stock > 0)
    .sort((a, b) => {
      const isLimonA = !!a.presentacion;
      const isLimonB = !!b.presentacion;
      if (isLimonA !== isLimonB) return isLimonA ? 1 : -1; // uva first
      if (isLimonA) {
        // sort limón by presentacion then talla
        const pa = a.presentacion || '';
        const pb = b.presentacion || '';
        if (pa !== pb) return pa.localeCompare(pb);
        return (a.talla || '').localeCompare(b.talla || '');
      }
      const va = a.variedad || '';
      const vb = b.variedad || '';
      if (va !== vb) return va.localeCompare(vb);
      if (a.mercado !== b.mercado) return a.mercado.localeCompare(b.mercado);
      const ta = a.tipo_cultivo || '';
      const tb = b.tipo_cultivo || '';
      return ta.localeCompare(tb);
    });

  return (
    <select
      value={selectedKey}
      onChange={handleChange}
      style={mergedStyle}
      disabled={disabled}
      className={className}
    >
      <option value="">{emptyLabel}</option>
      {itemsConStock.map((item, index) => {
        const mercadoLabel = item.mercado === 'exportacion' ? 'Exportación' : 'Nacional';
        let label: string;
        if (item.presentacion) {
          // Limón: simplificado (sin mercado, sin calidad/primera-segunda)
          const tallaPart = item.talla ? ` #${item.talla}` : '';
          const presLabel = item.presentacion === 'rpc_12' ? 'RPC 12' :
                            item.presentacion === 'rpc_18' ? 'RPC 18' :
                            item.presentacion === 'caja_40lbs' ? 'Caja 40 lbs' :
                            item.presentacion === 'bins_jugo' ? 'Bins 900kg' : item.presentacion;
          label = `${presLabel}${tallaPart} (${item.cantidad_stock})`;
        } else {
          const tipoLabel = item.tipo_cultivo === 'organica' ? 'Orgánica' : 'Convencional';
          label = `${item.variedad || ''} ${mercadoLabel} ${tipoLabel} (${item.cantidad_stock} cajas)`.trim();
        }
        return (
          <option key={index} value={getValueKey(item)}>
            {label}
          </option>
        );
      })}
    </select>
  );
}
