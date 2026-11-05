import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { intlLocale, makeT, type Locale, type T } from '@/i18n';

interface I18n {
  locale: Locale;
  /** BCP 47 tag for Intl formatters. */
  intl: string;
  t: T;
}

const Ctx = createContext<I18n>({ locale: 'de', intl: 'de-DE', t: makeT('de') });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, intl: intlLocale(locale), t: makeT(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  return useContext(Ctx);
}
