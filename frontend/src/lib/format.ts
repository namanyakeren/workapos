const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const plain = new Intl.NumberFormat('id-ID');

/** Money is always stored as integer cents (1/100 Rupiah). */
export function money(cents: number | null | undefined): string {
  return idr.format(Math.round(Number(cents || 0) / 100));
}

export function number(value: number | null | undefined): string {
  return plain.format(Number(value || 0));
}

export function moneyCompact(cents: number | null | undefined): string {
  const value = Number(cents || 0) / 100;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (abs >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (abs >= 1_000) return `Rp ${(value / 1_000).toFixed(0)} rb`;
  return `Rp ${Math.round(value)}`;
}

/** Convert a Rupiah text/number input into cents. */
export function toCents(rupiah: number | string): number {
  const value = typeof rupiah === 'string'
    ? Number(rupiah.replace(/[^\d,-]/g, '').replace(',', '.'))
    : Number(rupiah);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return Math.round(Number(cents || 0)) / 100;
}

export function dateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function timeOnly(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function clock(now: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);
}

export function dateLong(now: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export function uid(prefix = 'id'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}
