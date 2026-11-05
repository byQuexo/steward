import { ArrowUp, ChevronDown, Coins, Eraser, Plus, Square } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { ActivityTimeline } from '@/components/activity';
import { AgentAvatar, Beam, Orb } from '@/components/avatars';
import { CitationCard } from '@/components/citation';
import { VerdictDot, VerdictTrail } from '@/components/decision';
import { Markdown } from '@/components/markdown';
import { PresenceAvatar, PresenceCaption } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { useChat } from '@/context/chat';
import { useI18n } from '@/context/i18n';
import { useMe } from '@/context/session';
import type { MessageKey } from '@/i18n';
import { useElapsed } from '@/lib/clock';
import { effectTone } from '@/lib/look';
import { useMediaQuery, useReducedMotion } from '@/lib/motion';
import type { Line, Presence } from '@/lib/presence';
import type { CitationItem, Turn } from '@/lib/timeline';
import { usePoke } from '@/lib/use-poke';
import { usePresence } from '@/lib/use-presence';
import { cn, formatEur, formatNumber } from '@/lib/utils';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Wide screens get the stage column next to the conversation. */
const WIDE = '(min-width: 1200px)';

function useClockTime(ms: number | undefined): string | null {
  const { intl } = useI18n();
  if (!ms) return null;
  return new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

function CostChip({ turn }: { turn: Turn }) {
  const { t, intl } = useI18n();
  const eur = turn.cost.calls > 0 ? turn.cost.eur : (turn.runEur ?? 0);
  if (turn.cost.calls === 0 && !turn.runEur) return null;
  const tokens = turn.cost.inputTokens + turn.cost.outputTokens;
  const detail = `${t('act.costTokens', { input: formatNumber(turn.cost.inputTokens, intl), output: formatNumber(turn.cost.outputTokens, intl) })} · ${t('act.costCalls', { count: turn.cost.calls })}${turn.cost.models.length ? ` · ${turn.cost.models.join(', ')}` : ''}`;
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-[5px] border px-1.5 font-mono text-[10.5px] text-muted-foreground"
      title={detail}
      data-testid="cost-chip"
    >
      <Coins className="h-3 w-3" aria-hidden />
      <span className="sr-only">{t('act.cost')}: </span>
      <span className="tabular-nums text-foreground">{formatEur(eur, intl)}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">
        {formatNumber(tokens, intl)} {t('costs.tokens')}
      </span>
      <span className="sr-only">({detail})</span>
    </span>
  );
}

/** While Steward works: one quiet line under the user's message — his orb, his line, the seconds. */
function WorkingLine({ turn, presence, line }: { turn: Turn; presence: Presence; line: Line }) {
  const { t } = useI18n();
  const elapsed = useElapsed(turn.startedAt ?? Date.now(), true);
  return (
    <p className="flex min-h-6 items-center gap-2 text-[13.5px] text-muted-foreground" data-testid="working-line">
      <Orb state={presence.orb ?? 'working'} size={20} tint={presence.orb === 'breathing' ? 'approval' : undefined} />
      <span key={t(line.key, line.vars)} className="min-w-0 animate-fade-in truncate">
        {t(line.key, line.vars)}
      </span>
      <span aria-hidden>·</span>
      <span className="shrink-0 font-mono text-[12px] tabular-nums">{t('chat.elapsed', { seconds: Math.floor(elapsed / 1000) })}</span>
    </p>
  );
}

function TurnView({ turn, isLast, presence, line, wide }: { turn: Turn; isLast: boolean; presence: Presence; line: Line; wide: boolean }) {
  const me = useMe();
  const { t } = useI18n();
  const streaming = turn.status === 'streaming';
  const citations = turn.items.filter((x): x is CitationItem => x.kind === 'citation');
  const empty = !streaming && !turn.answer;
  const time = useClockTime(turn.startedAt);
  return (
    <li className="space-y-3" data-testid="turn" data-status={turn.status}>
      <div className="group flex items-center justify-end gap-2.5">
        {time && <span className="font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity duration-micro group-hover:opacity-100">{time}</span>}
        <div className="max-w-[80%] rounded-[16px] bg-secondary px-3.5 py-2 text-[14px] leading-relaxed text-secondary-foreground">
          <span className="sr-only">{t('chat.you')}: </span>
          <p className="whitespace-pre-wrap break-words">{turn.question}</p>
        </div>
      </div>

      <div className="group/turn min-w-0 space-y-2.5">
        <p className="flex items-center gap-2 text-[13px]">
          <AgentAvatar role="orchestrator" size={wide ? 22 : 30} paused interactive={false} />
          <span className="font-semibold text-foreground">{me.assistant}</span>
          {turn.restored && <span className="font-mono text-[11px] text-muted-foreground">{t('chat.restored')}</span>}
          <VerdictTrail turn={turn} />
          {time && <span className="ml-auto font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity duration-micro group-hover/turn:opacity-100">{time}</span>}
        </p>
        {streaming && isLast && <WorkingLine turn={turn} presence={presence} line={line} />}
        <ActivityTimeline turn={turn} />
        <div aria-live={isLast ? 'polite' : undefined} aria-busy={streaming} aria-atomic="false" className="text-[14.5px]" data-testid="answer">
          {turn.answer ? (
            <div className={cn(streaming && 'streaming-caret')}>
              <Markdown text={turn.answer} />
            </div>
          ) : streaming ? (
            <p className="sr-only">{t('chat.thinking', { assistant: me.assistant })}</p>
          ) : empty && turn.status !== 'error' ? (
            <p className="text-[13px] text-muted-foreground">{t('chat.emptyAnswer')}</p>
          ) : null}
        </div>
        {citations.length > 0 && (
          <section aria-label={t('cite.sources')} className="flex flex-wrap items-center gap-1.5">
            <h2 className="eyebrow mr-1">{t('cite.sources')}</h2>
            {citations.map((c) => (
              <CitationCard key={c.key} c={c} />
            ))}
          </section>
        )}
        {!streaming && <CostChip turn={turn} />}
      </div>
    </li>
  );
}

/** "Color means Warden decided": the twist, explained once, quietly. */
function Legend({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted-foreground', className)}>
      <span>{t('legend.title')}:</span>
      <span className="inline-flex items-center gap-1.5">
        <VerdictDot tone="allow" />
        {t('legend.allow')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <VerdictDot tone="approval" />
        {t('legend.approval')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <VerdictDot tone="deny" />
        {t('legend.deny')}
      </span>
    </p>
  );
}

function greetKey(hour: number): MessageKey {
  if (hour >= 5 && hour < 11) return 'hero.morning';
  if (hour >= 11 && hour < 17) return 'hero.day';
  if (hour >= 17 && hour < 23) return 'hero.evening';
  return 'hero.night';
}

// Typed once per page load; later visits to the empty chat show the line at once.
let greetedOnce = false;

/** Steward's greeting, typed out quickly once (no typing under reduced motion). */
function Greeting({ text, sub }: { text: string; sub: ReactNode }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(() => (reduced || greetedOnce ? text.length : 0));
  useEffect(() => {
    if (reduced || greetedOnce) {
      setN(text.length);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) {
        greetedOnce = true;
        window.clearInterval(id);
      }
    }, 28);
    return () => window.clearInterval(id);
  }, [text, reduced]);
  const typing = n < text.length;
  return (
    <>
      <h2 className="text-balance text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">
        <span className="sr-only">{text}</span>
        <span aria-hidden>
          {text.slice(0, n)}
          <span className={cn('ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.1em] bg-foreground/70', !typing && 'opacity-0')} />
        </span>
      </h2>
      <div className={cn('mt-1.5 min-h-5 text-[14px] text-muted-foreground transition-opacity duration-layout', typing ? 'opacity-0' : 'opacity-100')}>{sub}</div>
    </>
  );
}

/** The model route of the last answer (read-only info), as a quiet chip. */
function ModelChip({ turns }: { turns: Turn[] }) {
  const { t } = useI18n();
  const model = [...turns].reverse().find((x) => x.cost.models.length)?.cost.models.slice(-1)[0];
  const offline = !model || /script|offline|mock|demo|fake/i.test(model);
  const label = model ? (offline ? t('composer.offline') : model) : t('composer.noModel');
  return (
    <span
      className="inline-flex h-7 max-w-[12rem] items-center gap-1 rounded-full px-2.5 text-[12.5px] text-muted-foreground"
      title={t('composer.model', { model: model ?? label })}
      data-testid="model-chip"
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
    </span>
  );
}

/** The "+" in the composer: the role's suggested questions and "new conversation". */
function PlusMenu({ onPick, onClear, canClear, busy }: { onPick: (s: string) => void; onClear: () => void; canClear: boolean; busy: boolean }) {
  const me = useMe();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const item = 'flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('composer.more')}
        title={t('composer.more')}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-micro hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div id={id} className="absolute bottom-10 left-0 z-30 w-80 animate-fade-in rounded-[12px] border bg-popover p-1 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.6)]">
          {me.suggestions.length > 0 && <p className="eyebrow px-2.5 pb-1 pt-1.5">{t('chat.suggestions')}</p>}
          {me.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              className={item}
              onClick={() => {
                setOpen(false);
                onPick(s);
              }}
            >
              {s}
            </button>
          ))}
          <div className="my-1 border-t" />
          <button
            type="button"
            disabled={!canClear || busy}
            className={item}
            onClick={() => {
              setOpen(false);
              onClear();
            }}
          >
            <Eraser className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {t('chat.clear')}
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatPage() {
  const me = useMe();
  const { t } = useI18n();
  const { turns, busy, send, cancel, clear } = useChat();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const refocus = useRef(false);
  const reduced = useReducedMotion();
  const wide = useMediaQuery(WIDE);

  const last = turns[turns.length - 1];
  const { presence, nonce } = usePresence(
    {
      turn: last,
      typing: focused && text.trim().length > 0,
      testAs: !!me.impersonated_by,
      kill: me.kill_switch,
    },
    reduced,
  );
  const { poked, poke } = usePoke(presence.state);
  const line = poked ?? presence.say;

  // Keep the newest content in view unless the user scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = useCallback(
    async (message: string) => {
      const m = message.trim();
      if (!m || busy) return;
      setText('');
      stick.current = true;
      refocus.current = true;
      await send(m);
    },
    [busy, send],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(text);
    }
  };

  // Ctrl/⌘K focuses the composer from anywhere on the chat page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const empty = turns.length === 0;
  // The composer moves from the hero to the dock after the first message: keep the focus.
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [empty]);

  // Auto-grow the textarea (one line, up to 200px).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [text, empty]);

  const readOnly = !!me.impersonated_by;
  const firstName = me.name.split(/\s+/)[0] ?? me.name;
  const greeting = t('hero.greeting', { greet: t(greetKey(new Date().getHours())), name: firstName, assistant: me.assistant });
  const inlineAvatar = !empty && !wide;

  const totals = { allow: 0, approval: 0, deny: 0 };
  for (const turn of turns)
    for (const x of turn.items) {
      if ((x.kind === 'tool' || x.kind === 'handoff') && x.decision) {
        const tone = effectTone(x.decision.effect);
        if (tone !== 'muted') totals[tone] += 1;
      }
    }

  const composer = (
    <div className="space-y-2">
      {readOnly && <Alert variant="info">{t('chat.readOnly')}</Alert>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <Beam variant="working" active={busy}>
          <div
            className={cn(
              'rounded-[24px] border bg-card px-3 pb-2.5 pt-3 transition-colors duration-micro focus-within:border-foreground/30',
              busy && 'border-border',
            )}
          >
            <div className="flex items-start gap-2.5">
              {inlineAvatar && (
                <PresenceAvatar presence={presence} nonce={nonce} variant="inline" assistant={me.assistant} onPoke={poke} className="-mt-0.5" />
              )}
              <Label htmlFor={inputId} className="sr-only">
                {t('chat.inputLabel', { assistant: me.assistant })}
              </Label>
              <textarea
                id={inputId}
                ref={inputRef}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={t('chat.placeholder')}
                maxLength={4000}
                data-testid="chat-input"
                className={cn(
                  'block max-h-[200px] w-full flex-1 resize-none bg-transparent px-1.5 text-[15px] leading-6 placeholder:text-muted-foreground focus-visible:outline-none',
                  inlineAvatar ? 'min-h-9 py-1.5' : 'min-h-12 py-1',
                )}
              />
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <PlusMenu onPick={(s) => void submit(s)} onClear={() => void clear()} canClear={!empty} busy={busy} />
              <span className={cn('ml-1 hidden items-center gap-2.5 text-[11px] text-muted-foreground md:flex', !focused && 'md:hidden')} aria-hidden>
                <span className="inline-flex items-center gap-1">
                  <kbd>⏎</kbd> {t('chat.kbd.send')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd>⇧⏎</kbd> {t('chat.kbd.newline')}
                </span>
              </span>
              {!focused && (
                <span className="ml-1 hidden items-center gap-1 text-[11px] text-muted-foreground md:inline-flex" aria-hidden>
                  <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                </span>
              )}
              <span className="ml-auto" />
              <ModelChip turns={turns} />
              {busy ? (
                <button
                  type="button"
                  onClick={cancel}
                  aria-label={t('chat.stop')}
                  title={t('chat.stop')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <Square className="h-3 w-3 fill-current" aria-hidden />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!text.trim()}
                  aria-label={t('chat.send')}
                  title={t('chat.send')}
                  data-testid="chat-send"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </Beam>
      </form>
      <span className="sr-only" role="status">
        {busy ? t('chat.status.streaming') : turns.length > 0 ? t('chat.status.done') : ''}
      </span>
    </div>
  );

  const caption = (
    <span key={`${line.key}-${t(line.key, line.vars)}`} className="block animate-fade-in" data-testid="presence-line">
      {t(line.key, line.vars)}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">
        {t('chat.title')} · {me.assistant}
      </h1>
      <div ref={listRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="relative flex min-h-full flex-col">
            <div aria-hidden className="hero-grid pointer-events-none absolute inset-0" />
            <div className="relative mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-4 py-8">
              <PresenceAvatar presence={presence} nonce={nonce} variant="hero" assistant={me.assistant} onPoke={poke} />
              <PresenceCaption className="mt-4 w-full max-w-[560px] px-5 py-4">
                <Greeting text={greeting} sub={poked || presence.state !== 'idle' ? caption : t('hero.line')} />
              </PresenceCaption>
              <div className="mt-6 w-full">{composer}</div>
              {me.suggestions.length > 0 && (
                <section aria-labelledby="suggestions-title" className="mt-3 w-full">
                  <h3 id="suggestions-title" className="sr-only">
                    {t('chat.suggestions')}
                  </h3>
                  <ul className="flex flex-wrap justify-center gap-1.5">
                    {me.suggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submit(s)}
                          className="h-8 rounded-full border px-3 text-[13px] text-muted-foreground transition-colors duration-micro hover:border-foreground/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="eyebrow mt-8 text-center">
                <span className="tabular-nums">{t('chat.tools', { count: me.tools.length })}</span>
                <span aria-hidden> · </span>
                {t('chat.governed')}
              </p>
              <Legend className="mt-2" />
            </div>
          </div>
        ) : (
          <div className={cn('mx-auto flex min-h-full w-full justify-center gap-12 px-4', wide && 'pr-[292px]')}>
            {wide && (
              // The stage: Steward is there with you, next to the conversation.
              <aside aria-label={me.assistant} className="sticky top-0 flex self-start h-[calc(100dvh-2.75rem)] w-[240px] shrink-0 flex-col items-center justify-center pb-16">
                <PresenceAvatar presence={presence} nonce={nonce} variant="stage" assistant={me.assistant} onPoke={poke} />
                <PresenceCaption className="mt-4 w-full">
                  <p className="text-[13px] font-semibold">{me.assistant}</p>
                  <div className="mt-0.5 min-h-10 text-[13px] leading-5 text-muted-foreground">{caption}</div>
                </PresenceCaption>
              </aside>
            )}
            <div className="flex w-full max-w-[720px] min-w-0 flex-col">
              <header className="sticky top-0 z-20 -mx-1 flex h-11 items-center gap-3 bg-background px-1">
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={turns[0]?.question}>
                  {turns[0]?.question}
                </p>
                {(totals.allow > 0 || totals.approval > 0 || totals.deny > 0) && (
                  <p
                    className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] tabular-nums text-muted-foreground"
                    title={t('trail.summary', { count: totals.allow + totals.approval + totals.deny, ...totals })}
                  >
                    <span className="sr-only">{t('trail.summary', { count: totals.allow + totals.approval + totals.deny, ...totals })}</span>
                    {(['allow', 'approval', 'deny'] as const).map((k) =>
                      totals[k] > 0 ? (
                        <span key={k} aria-hidden className="inline-flex items-center gap-1">
                          <VerdictDot tone={k} />
                          {totals[k]}
                        </span>
                      ) : null,
                    )}
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void clear()}
                  disabled={busy}
                  aria-label={t('chat.clear')}
                  title={t('chat.clear')}
                  className="shrink-0"
                >
                  <Eraser aria-hidden />
                </Button>
              </header>
              <section aria-label={t('chat.messages')} className="flex-1 pb-8 pt-4">
                <ol className="space-y-10">
                  {turns.map((turn, i) => (
                    <TurnView key={turn.id} turn={turn} isLast={i === turns.length - 1} presence={presence} line={line} wide={wide} />
                  ))}
                </ol>
              </section>
              <div className="sticky bottom-0 z-20 -mx-4 bg-gradient-to-t from-background from-60% to-transparent px-4 pb-6 pt-8">{composer}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
