import { ArrowUp, Coins, Eraser, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { VoiceBeam } from 'voice-glow';

import { ActivityTimeline } from '@/components/activity';
import { Beam, Orb } from '@/components/avatars';
import { CitationCard } from '@/components/citation';
import { VerdictDot, VerdictTrail } from '@/components/decision';
import { Markdown } from '@/components/markdown';
import { PresenceView } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { useChat } from '@/context/chat';
import { useI18n } from '@/context/i18n';
import { useMe } from '@/context/session';
import type { MessageKey } from '@/i18n';
import { useReducedMotion, useResolvedTheme } from '@/lib/motion';
import type { CitationItem, Turn } from '@/lib/timeline';
import { usePresence } from '@/lib/use-presence';
import { cn, formatEur, formatNumber } from '@/lib/utils';
import { useVoice } from '@/lib/voice';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function CostChip({ turn }: { turn: Turn }) {
  const { t, intl } = useI18n();
  const eur = turn.cost.calls > 0 ? turn.cost.eur : (turn.runEur ?? 0);
  if (turn.cost.calls === 0 && !turn.runEur) return null;
  const tokens = turn.cost.inputTokens + turn.cost.outputTokens;
  const detail = `${t('act.costTokens', { input: formatNumber(turn.cost.inputTokens, intl), output: formatNumber(turn.cost.outputTokens, intl) })} · ${t('act.costCalls', { count: turn.cost.calls })}${turn.cost.models.length ? ` · ${turn.cost.models.join(', ')}` : ''}`;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground" title={detail} data-testid="cost-chip">
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

function TurnView({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  const me = useMe();
  const { t } = useI18n();
  const streaming = turn.status === 'streaming';
  const citations = turn.items.filter((x): x is CitationItem => x.kind === 'citation');
  const empty = !streaming && !turn.answer;
  return (
    <li className="space-y-3" data-testid="turn" data-status={turn.status}>
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[10px] rounded-tr-[3px] bg-secondary px-3 py-1.5 text-[14px] leading-relaxed text-secondary-foreground">
          <span className="sr-only">{t('chat.you')}: </span>
          <p className="whitespace-pre-wrap break-words">{turn.question}</p>
        </div>
      </div>

      <div className="min-w-0 space-y-2.5">
        <p className="flex items-center gap-2.5 text-[12px]">
          <span className="font-semibold text-foreground">{me.assistant}</span>
          {turn.restored && <span className="font-mono text-[11px] text-muted-foreground">{t('chat.restored')}</span>}
          <VerdictTrail turn={turn} />
        </p>
        <ActivityTimeline turn={turn} />
        <div aria-live={isLast ? 'polite' : undefined} aria-busy={streaming} aria-atomic="false" className="text-[14px]" data-testid="answer">
          {turn.answer ? (
            <div className={cn(streaming && 'streaming-caret')}>
              <Markdown text={turn.answer} />
            </div>
          ) : streaming ? (
            <p className="text-[13px] text-muted-foreground">{t('chat.thinking', { assistant: me.assistant })}</p>
          ) : empty && turn.status !== 'error' ? (
            <p className="text-[13px] text-muted-foreground">{t('chat.emptyAnswer')}</p>
          ) : null}
        </div>
        {citations.length > 0 && (
          <section aria-label={t('cite.sources')} className="space-y-1.5">
            <h2 className="eyebrow">{t('cite.sources')}</h2>
            <ul className="flex flex-wrap gap-2">
              {citations.map((c) => (
                <li key={c.key} className="w-full max-w-md">
                  <CitationCard c={c} />
                </li>
              ))}
            </ul>
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

function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
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
function Greeting({ text, sub }: { text: string; sub: string }) {
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
    <div className="text-center">
      <h2 className="text-balance text-[24px] font-semibold leading-tight tracking-[-0.025em] sm:text-[28px]">
        <span className="sr-only">{text}</span>
        <span aria-hidden>
          {text.slice(0, n)}
          <span className={cn('ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.1em] bg-foreground/70', !typing && 'opacity-0')} />
        </span>
      </h2>
      <p className={cn('mt-1.5 text-[13.5px] text-muted-foreground transition-opacity duration-layout', typing ? 'opacity-0' : 'opacity-100')}>{sub}</p>
    </div>
  );
}

export function ChatPage() {
  const me = useMe();
  const { t } = useI18n();
  const { turns, busy, send, cancel, clear } = useChat();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const inputId = useId();
  const voiceId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const pressing = useRef(false);
  const refocus = useRef(false);
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();

  const voice = useVoice(me.voice.mode, me.voice.language, {
    unsupported: t('voice.unsupported'),
    denied: t('voice.denied'),
    failed: (error) => t('voice.failed', { error }),
  });

  const last = turns[turns.length - 1];
  const { presence, nonce } = usePresence(
    {
      turn: last,
      typing: focused && text.trim().length > 0,
      listening: voice.state === 'listening',
      testAs: !!me.impersonated_by,
      kill: me.kill_switch,
    },
    reduced,
  );

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
    async (message: string, viaVoice = false) => {
      const m = message.trim();
      if (!m || busy) return;
      setText('');
      stick.current = true;
      refocus.current = !viaVoice;
      const turn = await send(m, { voice: viaVoice });
      if (viaVoice && turn?.answer) void voice.speak(turn.answer);
    },
    [busy, send, voice],
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

  const startTalk = () => {
    if (pressing.current || busy) return;
    pressing.current = true;
    voice.stopSpeaking();
    void voice.start();
  };
  const endTalk = async () => {
    if (!pressing.current) return;
    pressing.current = false;
    const heard = await voice.stop();
    if (heard) void submit(heard, true);
  };

  // Auto-grow the textarea (one line, up to 200px).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + border, 200)}px`;
    el.style.overflowY = el.scrollHeight + border > 200 ? 'auto' : 'hidden';
  }, [text, empty, voiceMode]);

  const readOnly = !!me.impersonated_by;
  const listening = voice.state === 'listening';
  const firstName = me.name.split(/\s+/)[0] ?? me.name;
  const greeting = t('hero.greeting', { greet: t(greetKey(new Date().getHours())), name: firstName, assistant: me.assistant });

  const composer = (
    <div className="space-y-1.5">
      {readOnly && <Alert variant="info">{t('chat.readOnly')}</Alert>}
      {voice.error && <Alert variant="error">{voice.error}</Alert>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <VoiceBeam
          stream={listening ? voice.micStream : null}
          level={voice.speaking ? voice.outputLevel : 0}
          active={voiceMode && (listening || voice.speaking) && !reduced}
          colorVariant="mono"
          theme={theme}
          idle={0}
          borderRadius={10}
          className="block"
        >
          <Beam variant="working" active={busy}>
            <div className={cn('rounded-[10px] border border-input bg-card transition-colors duration-micro focus-within:border-ring', busy && 'border-border')}>
              {voiceMode ? (
                <div className="flex min-h-[42px] items-center gap-2.5 py-1 pl-1.5 pr-1.5">
                  <Button
                    type="button"
                    size="icon"
                    variant={listening ? 'outline' : 'default'}
                    className={cn('h-8 w-8 shrink-0 rounded-[7px]', listening && 'border-foreground')}
                    aria-label={t('voice.holdKey')}
                    aria-pressed={listening}
                    disabled={busy || !voice.supported || voice.state === 'transcribing'}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startTalk();
                    }}
                    onPointerUp={() => void endTalk()}
                    onPointerLeave={() => void endTalk()}
                    onKeyDown={(e) => {
                      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                        e.preventDefault();
                        startTalk();
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        void endTalk();
                      }
                    }}
                  >
                    <Mic aria-hidden />
                  </Button>
                  <p className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px]" aria-live="polite">
                    {listening ? (
                      <span className="text-foreground">{voice.interim || t('voice.listening')}</span>
                    ) : voice.state === 'transcribing' ? (
                      <>
                        <Orb state="working" size={20} />
                        <span className="text-muted-foreground">{t('voice.transcribing')}</span>
                      </>
                    ) : !voice.supported ? (
                      <span className="text-muted-foreground">{t('voice.unsupported')}</span>
                    ) : voice.interim ? (
                      <span className="text-muted-foreground">
                        {t('voice.transcript')}: {voice.interim}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('voice.hold')}</span>
                    )}
                  </p>
                  {voice.speaking && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={voice.stopSpeaking} aria-label={t('voice.stopSpeaking')}>
                      <VolumeX aria-hidden />
                    </Button>
                  )}
                  {busy && (
                    <Button type="button" size="icon-sm" variant="outline" className="shrink-0" onClick={cancel} aria-label={t('chat.stop')} title={t('chat.stop')}>
                      <Square className="!size-3" aria-hidden />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex items-end gap-2 py-[5px] pl-3 pr-[5px]">
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
                    className="block max-h-[200px] min-h-8 w-full flex-1 resize-none bg-transparent py-[6px] text-[14px] leading-5 placeholder:text-muted-foreground focus-visible:outline-none"
                  />
                  {busy ? (
                    <Button type="button" size="icon-sm" variant="outline" className="h-8 w-8 shrink-0" onClick={cancel} aria-label={t('chat.stop')} title={t('chat.stop')}>
                      <Square className="!size-3" aria-hidden />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="icon-sm"
                      className="h-8 w-8 shrink-0"
                      disabled={!text.trim()}
                      aria-label={t('chat.send')}
                      title={t('chat.send')}
                      data-testid="chat-send"
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Beam>
        </VoiceBeam>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-0.5 text-[11.5px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <Switch
            id={voiceId}
            checked={voiceMode}
            onCheckedChange={(v) => {
              setVoiceMode(v);
              if (!v) voice.stopSpeaking();
            }}
            aria-describedby={`${voiceId}-hint`}
          />
          <Label htmlFor={voiceId} className="text-[11.5px] font-medium text-foreground">
            {t('voice.mode')}
          </Label>
          <span id={`${voiceId}-hint`} className={voiceMode ? 'hidden sm:inline' : 'sr-only'}>
            {voiceMode ? t('approval.clickOnly') : t('voice.modeHint')}
          </span>
          {voice.speaking && (
            <span className="inline-flex items-center gap-1">
              <Volume2 className="h-3 w-3" aria-hidden />
              {t('voice.speaking')}
            </span>
          )}
        </div>
        {!voiceMode && (
          <p className="hidden items-center gap-2.5 md:flex" aria-hidden>
            <span className="inline-flex items-center gap-1">
              <Kbd>⏎</Kbd> {t('chat.kbd.send')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>⇧⏎</Kbd> {t('chat.kbd.newline')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd> {t('chat.kbd.focus')}
            </span>
          </p>
        )}
        <span className="sr-only" role="status">
          {busy ? t('chat.status.streaming') : turns.length > 0 ? t('chat.status.done') : ''}
        </span>
      </div>
    </div>
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
            <div className="relative mx-auto flex w-full max-w-[680px] flex-1 flex-col items-center justify-center px-4 py-8">
              <PresenceView presence={presence} nonce={nonce} variant="hero" assistant={me.assistant} />
              <div className="mt-3">
                <Greeting text={greeting} sub={t('hero.line')} />
              </div>
              <div className="mt-6 w-full">{composer}</div>
              {me.suggestions.length > 0 && (
                <section aria-labelledby="suggestions-title" className="mt-4 w-full">
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
                          className="h-7 rounded-[6px] border px-2.5 text-[12.5px] text-muted-foreground transition-colors duration-micro hover:border-foreground/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
          <section aria-label={t('chat.messages')} className="mx-auto w-full max-w-[720px] px-4 pb-6 pt-5">
            <ol className="space-y-7">
              {turns.map((turn, i) => (
                <TurnView key={turn.id} turn={turn} isLast={i === turns.length - 1} />
              ))}
            </ol>
          </section>
        )}
      </div>

      {!empty && (
        <div className="relative shrink-0 pb-[max(env(safe-area-inset-bottom),10px)]">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
          <div className="mx-auto w-full max-w-[720px] space-y-1.5 px-4">
            <div className="flex h-8 items-center justify-between gap-3">
              <PresenceView presence={presence} nonce={nonce} variant="dock" assistant={me.assistant} className="min-w-0" />
              <Button variant="ghost" size="sm" onClick={() => void clear()} disabled={busy || turns.length === 0} className="shrink-0">
                <Eraser aria-hidden />
                {t('chat.clear')}
              </Button>
            </div>
            {composer}
          </div>
        </div>
      )}
    </div>
  );
}
