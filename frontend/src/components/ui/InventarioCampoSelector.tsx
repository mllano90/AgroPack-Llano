import type { InventarioCampoItem, Variedad, TipoMercado } from '../../types';

interface InventarioCampoSelectorProps {
  inventario: InventarioCampoItem[];
  value: InventarioCampoItem | null;
  onChange: (item: InventarioCampoItem | null) => void;
  style?: React.CSSProperties;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Reusable selector for Inventario de Campo (Variedad + Mercado).
 * Returns the full InventarioCampoItem on selection.
 */
export default function InventarioCampoSelector({
  inventario,
  value,
  onChange,
  style,
  emptyLabel = 'Seleccionar Inventario de Campo',
  disabled = false,
  className,
}: InventarioCampoSelectorProps) {
  const defaultStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    margin: '10px 0',
  };

  const mergedStyle = { ...defaultStyle, ...style };

  const getValueKey = (item: InventarioCampoItem) => `${item.variedad}-${item.mercado}`;

  const selectedKey = value ? getValueKey(value) : '';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    if (!key) {
      onChange(null);
      return;
    }
    const [variedad, mercado] = key.split('-') as [Variedad, TipoMercado];
    const found = inventario.find(
      (item) => item.variedad === variedad && item.mercado === mercado
    );
    onChange(found || null);
  };

  return (
    <select
      value={selectedKey}
      onChange={handleChange}
      style={mergedStyle}
      disabled={disabled}
      className={className}
    >
      <option value="">{emptyLabel}</option>
      {inventario.map((item, index) => {
        const mercadoLabel = item.mercado === 'exportacion' ? 'Exportación' : 'Nacional';
        const label = `${item.variedad} ${mercadoLabel} (${item.cantidad} cajas)`;
        return (
          <option key={index} value={getValueKey(item)}>
            {label}
          </option>
        );
      })}
    </select>
  );
}
