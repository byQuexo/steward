import { BadgeCheck, ImageOff, Maximize2 } from 'lucide-react';
import { useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useI18n } from '@/context/i18n';
import { api } from '@/lib/api';
import type { CitationItem } from '@/lib/timeline';

function pageUrl(c: Pick<CitationItem, 'url' | 'docId' | 'page'>): string {
  return c.url && c.url.startsWith('/api/docs/pages/') ? c.url : api.pageImageUrl(c.docId, c.page);
}

function PageImage({ src, alt, className, small }: { src: string; alt: string; className?: string; small?: boolean }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (failed && small) return <ImageOff className="m-auto h-3 w-3 text-muted-foreground" aria-label={t('cite.imageFailed')} />;
  if (failed) {
    return (
      <div className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
        <ImageOff className="h-5 w-5" aria-hidden />
        <span>{t('cite.imageFailed')}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} loading="lazy" decoding="async" />;
}

/** A verified citation as a compact chip; it opens a lightbox with the page image and the quote. */
export function CitationCard({ c }: { c: CitationItem }) {
  const { t } = useI18n();
  const src = pageUrl(c);
  const alt = t('cite.imageAlt', { page: c.page, title: c.title });
  return (
    <Dialog>
      {/* A compact source chip: page thumbnail, document, page; the quote is in the lightbox. */}
      <span className="inline-flex max-w-full" data-testid="citation-card">
        <DialogTrigger asChild>
          <button
            type="button"
            title={c.quote}
            aria-label={t('cite.open', { page: c.page, title: c.title })}
            className="group inline-flex h-9 max-w-full items-center gap-2 rounded-[8px] border bg-card py-1 pl-1 pr-2.5 text-left transition-colors duration-micro hover:border-foreground/25 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="relative h-7 w-[21px] shrink-0 overflow-hidden rounded-[3px] border bg-white">
              <PageImage src={src} alt="" small className="h-full w-full object-cover object-top" />
            </span>
            <span className="min-w-0 truncate text-[12.5px] text-foreground">{c.title}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{t('cite.page', { page: c.page })}</span>
            <BadgeCheck className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <Maximize2 className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </button>
        </DialogTrigger>
      </span>
      <DialogContent closeLabel={t('cite.close')} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription className="font-mono text-[12px] tabular-nums">{t('cite.page', { page: c.page })}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border bg-white">
          <PageImage src={src} alt={alt} className="mx-auto max-h-[60vh] w-auto" />
        </div>
        <figure className="rounded-md border bg-muted/50 p-3.5">
          <figcaption className="eyebrow mb-1.5 flex items-center gap-1.5">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {t('cite.verified')}
          </figcaption>
          <blockquote className="text-[14px] leading-relaxed">
            <mark className="quote-highlight">{c.quote}</mark>
          </blockquote>
        </figure>
      </DialogContent>
    </Dialog>
  );
}
