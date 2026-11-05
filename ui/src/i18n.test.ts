import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { messages, pickLocale, translate, type MessageKey } from './i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

describe('i18n', () => {
  const de = messages.de;
  const en = messages.en;
  const keys = Object.keys(de) as MessageKey[];

  it('has the same keys in every locale', () => {
    expect(Object.keys(en).sort()).toEqual(keys.slice().sort());
  });

  it('has no empty strings', () => {
    for (const [locale, dict] of Object.entries(messages)) {
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim(), `${locale}:${k}`).not.toBe('');
      }
    }
  });

  it('uses the same placeholders in every locale', () => {
    for (const k of keys) {
      expect(placeholders(en[k]), k).toEqual(placeholders(de[k]));
    }
  });

  it('defines every key the source uses', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (m[1]) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(50);
    const missing = [...used].filter((k) => !(k in de));
    expect(missing).toEqual([]);
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(translate('de', 'approval.fourEyesProgress', { done: 1, needed: 2 })).toBe('1 von 2 Freigaben');
    expect(translate('en', 'approval.fourEyesProgress', { done: 1 })).toBe('1 of {needed} approvals');
  });

  it('picks the locale from the profile', () => {
    expect(pickLocale('de')).toBe('de');
    expect(pickLocale('de-DE')).toBe('de');
    expect(pickLocale('en')).toBe('en');
    expect(pickLocale('fr')).toBe('en');
    expect(pickLocale(undefined)).toBe('en');
  });
});
