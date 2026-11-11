import { TextField } from '@mui/material';

interface AmountFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  unit?: string;
  error?: boolean;
  helperText?: string;
}

// Plain text entry for an amount (replaces the old on-screen numpad). Keeps only digits and
// a single decimal point, so what's stored is always something Number()/ethers can parse.
export function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const [head, ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${head}.${rest.join('')}` : head;
}

export default function AmountField({ value, onChange, label, unit, error, helperText }: AmountFieldProps) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(sanitizeAmount(e.target.value))}
      fullWidth
      error={error}
      helperText={helperText}
      placeholder="0"
      slotProps={{
        htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
        input: unit ? { endAdornment: <span style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>{unit}</span> } : undefined,
      }}
    />
  );
}
