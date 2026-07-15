import type { TipoMercado } from '../../types';
import { MERCADO_OPTIONS } from '../../lib/constants';

interface MercadoSelectProps {
  value: TipoMercado;
  onChange: (value: TipoMercado) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
  includeEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}

export default function MercadoSelect({
  value,
  onChange,
  style,
  disabled = false,
  includeEmpty = false,
  emptyLabel = 'Seleccionar Mercado',
  className,
}: MercadoSelectProps) {
  const defaultStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    margin: '10px 0',
  };

  const mergedStyle = { ...defaultStyle, ...style };

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TipoMercado)}
      style={mergedStyle}
      disabled={disabled}
      className={className}
    >
      {includeEmpty && <option value="">{emptyLabel}</option>}
      {MERCADO_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
