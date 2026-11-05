import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '@/context/i18n';
import { cn } from '@/lib/utils';

type Variant = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  text: string;
  variant: Variant;
  link?: { to: string; label: string };
}

interface ToastApi {
  toast: (text: string, opts?: { variant?: Variant; link?: { to: string; label: string } }) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const { t } = useI18n();

  const dismiss = useCallback((id: number) => setToasts((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useCallback<ToastApi['toast']>(
    (text, opts) => {
      const id = next.current++;
      setToasts((xs) => [...xs.slice(-3), { id, text, variant: opts?.variant ?? 'info', link: opts?.link }]);
      window.setTimeout(() => dismiss(id), 7000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);
  const icons = { info: Info, success: CheckCircle2, error: XCircle };

  return (
    <Ctx.Provider value={api}>
      {children}
      <section
        aria-label={t('common.notifications')}
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {toasts.map((x) => {
            const Icon = icons[x.variant];
            return (
              <div
                key={x.id}
                className={cn(
                  'pointer-events-auto flex animate-fade-in items-start gap-3 rounded-lg border bg-popover p-3.5 text-sm text-popover-foreground shadow-lg',
                  x.variant === 'error' && 'border-deny/40',
                  x.variant === 'success' && 'border-allow/40',
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    x.variant === 'error' ? 'text-deny' : x.variant === 'success' ? 'text-allow' : 'text-primary',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p>{x.text}</p>
                  {x.link && (
                    <Link to={x.link.to} className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline" onClick={() => dismiss(x.id)}>
                      {x.link.label}
                    </Link>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(x.id)}
                  className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden />
                  <span className="sr-only">{t('common.dismiss')}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(Ctx);
}
