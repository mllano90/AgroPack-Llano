import type { TipoCultivo } from '../../types';
import { TIPO_CULTIVO_OPTIONS } from '../../lib/constants';

interface TipoCultivoSelectProps {
  value: TipoCultivo | '';
  onChange: (value: TipoCultivo | '') => void;
  includeEmpty?: boolean;
  emptyLabel?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  className?: string;
}

export default function TipoCultivoSelect({
  value,
  onChange,
  includeEmpty = true,
  emptyLabel = 'Tipo',
  style,
  disabled = false,
  className,
}: TipoCultivoSelectProps) {
  const defaultStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    margin: '10px 0',
  };

  const mergedStyle = { ...defaultStyle, ...style };

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TipoCultivo | '')}
      style={mergedStyle}
      disabled={disabled}
      className={className}
    >
      {includeEmpty && <option value="">{emptyLabel}</option>}
      {TIPO_CULTIVO_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
