import { Delete, X } from 'lucide-react';

interface KeypadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  maxLength?: number;
  disabled?: boolean;
  compact?: boolean;
}

export function PinDots({ length, max = 12 }: { length: number; max?: number }) {
  const visible = Math.max(max, 4);
  return (
    <div className="pin-dots" aria-label={`${length} digit PIN`}>
      {Array.from({ length: Math.min(visible, Math.max(4, length || 4)) }).map((_, index) => (
        <span key={index} className={`pin-dot ${index < length ? 'filled' : ''}`} />
      ))}
    </div>
  );
}

export function Keypad({
  value,
  onChange,
  onSubmit,
  maxLength = 12,
  disabled = false,
  compact = false,
}: KeypadProps) {
  const press = (digit: string) => {
    if (disabled) return;
    if (value.length >= maxLength) return;
    // Avoid leading zero noise for numeric amounts.
    if (value === '0' && digit !== '0') {
      onChange(digit);
      return;
    }
    if (value === '0' && digit === '0') return;
    onChange(`${value}${digit}`);
  };

  return (
    <div className={`keypad ${compact ? 'compact' : ''}`}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
        <button
          key={digit}
          type="button"
          className="keypad-key"
          disabled={disabled}
          onClick={() => press(digit)}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className="keypad-key keypad-muted"
        disabled={disabled}
        onClick={() => onChange('')}
        aria-label="Hapus semua"
      >
        <X size={22} />
      </button>
      <button
        type="button"
        className="keypad-key"
        disabled={disabled}
        onClick={() => press('0')}
      >
        0
      </button>
      <button
        type="button"
        className="keypad-key keypad-muted"
        disabled={disabled}
        onClick={() => onChange(value.slice(0, -1))}
        aria-label="Hapus satu digit"
      >
        <Delete size={23} />
      </button>
      {onSubmit ? (
        <button
          type="button"
          className="keypad-submit"
          disabled={disabled}
          onClick={onSubmit}
        >
          Masuk
        </button>
      ) : null}
    </div>
  );
}
