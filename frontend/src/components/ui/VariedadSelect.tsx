import type { Variedad } from '../../types';
import { VARIEDADES } from '../../lib/constants';

interface VariedadSelectProps {
  value: Variedad | '';
  onChange: (value: Variedad | '') => void;
  includeEmpty?: boolean;
  emptyLabel?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  className?: string;
}

export default function VariedadSelect({
  value,
  onChange,
  includeEmpty = true,
  emptyLabel = 'Seleccionar Variedad',
  style,
  disabled = false,
  className,
}: VariedadSelectProps) {
  const defaultStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    margin: '10px 0',
  };

  const mergedStyle = { ...defaultStyle, ...style };

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Variedad | '')}
      style={mergedStyle}
      disabled={disabled}
      className={className}
    >
      {includeEmpty && <option value="">{emptyLabel}</option>}
      {VARIEDADES.map((v) => (
        <option key={v.value} value={v.value}>
          {v.label}
        </option>
      ))}
    </select>
  );
}
