import { FileText, ImageOff, Maximize2, Quote } from 'lucide-react';
import { useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useI18n } from '@/context/i18n';
import { api } from '@/lib/api';
import type { CitationItem } from '@/lib/timeline';

function pageUrl(c: Pick<CitationItem, 'url' | 'docId' | 'page'>): string {
  return c.url && c.url.startsWith('/api/docs/pages/') ? c.url : api.pageImageUrl(c.docId, c.page);
}

function PageImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
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

/** A verified citation: title, page, quote and a page thumbnail that opens a lightbox. */
export function CitationCard({ c }: { c: CitationItem }) {
  const { t } = useI18n();
  const src = pageUrl(c);
  const alt = t('cite.imageAlt', { page: c.page, title: c.title });
  return (
    <Dialog>
      <div className="group flex w-full max-w-md items-stretch gap-3 rounded-lg border bg-card p-2.5 shadow-sm" data-testid="citation-card">
        <DialogTrigger asChild>
          <button
            type="button"
            className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('cite.open', { page: c.page, title: c.title })}
          >
            <PageImage src={src} alt="" className="h-full w-full object-cover object-top" />
            <span className="absolute bottom-1 right-1 rounded bg-black/55 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
              <Maximize2 className="h-3 w-3" />
            </span>
          </button>
        </DialogTrigger>
        <div className="min-w-0 flex-1 py-0.5">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">{c.title}</span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">{t('cite.page', { page: c.page })}</span>
          </p>
          <blockquote className="mt-1.5 line-clamp-3 border-l-2 border-primary/40 pl-2 text-sm leading-snug">{c.quote}</blockquote>
          <p className="mt-1 text-[11px] font-medium text-allow-foreground">{t('cite.verified')}</p>
        </div>
      </div>
      <DialogContent closeLabel={t('cite.close')} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{t('cite.page', { page: c.page })}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border bg-white">
          <PageImage src={src} alt={alt} className="mx-auto max-h-[60vh] w-auto" />
        </div>
        <figure className="rounded-md border bg-muted/40 p-3">
          <figcaption className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Quote className="h-3.5 w-3.5" aria-hidden />
            {t('cite.verified')}
          </figcaption>
          <blockquote className="text-sm leading-relaxed">
            <mark className="quote-highlight">{c.quote}</mark>
          </blockquote>
        </figure>
      </DialogContent>
    </Dialog>
  );
}
