import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEur(v: number, locale: string, currency = 'EUR'): string {
  const abs = Math.abs(v);
  // Model calls cost fractions of a cent: show enough digits to be meaningful.
  const digits = abs === 0 ? 2 : abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function formatNumber(v: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(v);
}

export function formatDateTime(unixSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(unixSeconds * 1000));
}

export function formatDate(unixSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(unixSeconds * 1000));
}

export function formatRelative(unixSeconds: number, locale: string, now = Date.now()): string {
  const diff = Math.round(unixSeconds - now / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** Stable 32-bit hash (FNV-1a) for generated avatars and colors. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Pretty-print a tool result preview when it is JSON, else return it as is. */
export function prettyPreview(preview: string): string {
  const s = preview.trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return preview;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return preview;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
