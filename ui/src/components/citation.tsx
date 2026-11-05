import { BadgeCheck, ImageOff, Maximize2 } from 'lucide-react';
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
      <div className="group flex w-full max-w-md items-stretch gap-3 rounded-md border bg-card p-2 transition-colors duration-micro hover:border-foreground/25" data-testid="citation-card">
        <DialogTrigger asChild>
          <button
            type="button"
            className="relative h-[72px] w-[54px] shrink-0 overflow-hidden rounded-[4px] border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('cite.open', { page: c.page, title: c.title })}
          >
            <PageImage src={src} alt="" className="h-full w-full object-cover object-top" />
            <span className="absolute bottom-1 right-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity duration-micro group-hover:opacity-100" aria-hidden>
              <Maximize2 className="h-3 w-3" />
            </span>
          </button>
        </DialogTrigger>
        <div className="min-w-0 flex-1 py-0.5">
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{c.title}</span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap tabular-nums">{t('cite.page', { page: c.page })}</span>
          </p>
          <blockquote className="mt-1 line-clamp-2 border-l border-foreground/50 pl-2 text-[12.5px] leading-snug">{c.quote}</blockquote>
          {/* Verification is not a Warden verdict: grey, with a glyph. */}
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <BadgeCheck className="h-3 w-3" aria-hidden />
            {t('cite.verified')}
          </p>
        </div>
      </div>
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
