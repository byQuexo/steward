import { ArrowUp, Coins, Eraser, Lightbulb, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { ActivityTimeline } from '@/components/activity';
import { BotAvatar, ThinkingOrb, UserAvatar } from '@/components/avatars';
import { CitationCard } from '@/components/citation';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { useChat } from '@/context/chat';
import { useI18n } from '@/context/i18n';
import { useMe } from '@/context/session';
import type { CitationItem, Turn } from '@/lib/timeline';
import { cn, formatEur, formatNumber } from '@/lib/utils';
import { useVoice } from '@/lib/voice';

function CostChip({ turn }: { turn: Turn }) {
  const { t, intl } = useI18n();
  const eur = turn.cost.calls > 0 ? turn.cost.eur : (turn.runEur ?? 0);
  if (turn.cost.calls === 0 && !turn.runEur) return null;
  const tokens = turn.cost.inputTokens + turn.cost.outputTokens;
  const detail = `${t('act.costTokens', { input: formatNumber(turn.cost.inputTokens, intl), output: formatNumber(turn.cost.outputTokens, intl) })} · ${t('act.costCalls', { count: turn.cost.calls })}${turn.cost.models.length ? ` · ${turn.cost.models.join(', ')}` : ''}`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground" title={detail} data-testid="cost-chip">
      <Coins className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{t('act.cost')}: </span>
      <span className="font-medium tabular-nums text-foreground">{formatEur(eur, intl)}</span>
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
    <li className="space-y-4" data-testid="turn" data-status={turn.status}>
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          <span className="sr-only">{t('chat.you')}: </span>
          <p className="whitespace-pre-wrap break-words">{turn.question}</p>
        </div>
        <UserAvatar name={me.name} size={30} className="mt-0.5 hidden sm:inline-flex" />
      </div>

      <div className="flex gap-3">
        <div className="mt-0.5 w-[30px] shrink-0">
          {streaming ? <ThinkingOrb size={30} /> : <BotAvatar seed={me.agent || me.assistant} size={30} />}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            {me.assistant}
            {turn.restored && <span className="ml-2 font-normal">· {t('chat.restored')}</span>}
          </p>
          <ActivityTimeline turn={turn} />
          <div
            aria-live={isLast ? 'polite' : undefined}
            aria-busy={streaming}
            aria-atomic="false"
            className="text-[15px]"
            data-testid="answer"
          >
            {turn.answer ? (
              <div className={cn(streaming && 'streaming-caret')}>
                <Markdown text={turn.answer} />
              </div>
            ) : streaming ? (
              <p className="text-sm text-muted-foreground">{t('chat.thinking', { assistant: me.assistant })}</p>
            ) : empty && turn.status !== 'error' ? (
              <p className="text-sm text-muted-foreground">{t('chat.emptyAnswer')}</p>
            ) : null}
          </div>
          {citations.length > 0 && (
            <section aria-label={t('cite.sources')} className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('cite.sources')}</h3>
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
      </div>
    </li>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (s: string) => void; disabled: boolean }) {
  const me = useMe();
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-10 text-center sm:py-16">
      <ThinkingOrb size={56} active={false} />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{me.greeting}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('chat.tools', { count: me.tools.length })}</p>
      {me.suggestions.length > 0 && (
        <section aria-labelledby="suggestions-title" className="mt-8 w-full">
          <h3 id="suggestions-title" className="mb-3 flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden />
            {t('chat.suggestions')}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {me.suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(s)}
                  className="h-full w-full rounded-xl border bg-card px-4 py-3 text-left text-sm shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ChatPage() {
  const me = useMe();
  const { t } = useI18n();
  const { turns, busy, send, cancel, clear } = useChat();
  const [text, setText] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const inputId = useId();
  const voiceId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const pressing = useRef(false);

  const voice = useVoice(me.voice.mode, me.voice.language, {
    unsupported: t('voice.unsupported'),
    denied: t('voice.denied'),
    failed: (error) => t('voice.failed', { error }),
  });

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

  // Auto-grow the textarea.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + border, 200)}px`;
    el.style.overflowY = el.scrollHeight + border > 200 ? 'auto' : 'hidden';
  }, [text]);

  const readOnly = !!me.impersonated_by;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b bg-background/60">
        <div className="container flex max-w-4xl items-center justify-between gap-2 py-2">
          <h1 className="text-sm font-semibold">
            {t('chat.title')} <span className="font-normal text-muted-foreground">· {me.assistant}</span>
          </h1>
          <Button variant="ghost" size="sm" onClick={() => void clear()} disabled={busy || turns.length === 0}>
            <Eraser aria-hidden />
            {t('chat.clear')}
          </Button>
        </div>
      </div>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <EmptyState onPick={(s) => void submit(s)} disabled={busy} />
        ) : (
          <section aria-label={t('chat.messages')} className="container max-w-4xl py-6">
            <ol className="space-y-8">
              {turns.map((turn, i) => (
                <TurnView key={turn.id} turn={turn} isLast={i === turns.length - 1} />
              ))}
            </ol>
          </section>
        )}
      </div>

      <div className="shrink-0 border-t bg-card/60 pb-[env(safe-area-inset-bottom)]">
        <div className="container max-w-4xl space-y-2 py-3">
          {readOnly && <Alert variant="warning">{t('chat.readOnly')}</Alert>}
          {voice.error && <Alert variant="error">{voice.error}</Alert>}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(text);
            }}
          >
            {voiceMode ? (
              <div className="flex min-h-[44px] flex-1 items-center gap-3 rounded-xl border bg-card px-3 py-2 shadow-sm">
                <Button
                  type="button"
                  size="icon"
                  variant={voice.state === 'listening' ? 'destructive' : 'default'}
                  className="h-10 w-10 shrink-0 rounded-full"
                  aria-label={t('voice.holdKey')}
                  aria-pressed={voice.state === 'listening'}
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
                <p className="min-w-0 flex-1 text-sm" aria-live="polite">
                  {voice.state === 'listening' ? (
                    <span className="text-foreground">{voice.interim || t('voice.listening')}</span>
                  ) : voice.state === 'transcribing' ? (
                    <span className="text-muted-foreground">{t('voice.transcribing')}</span>
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
              </div>
            ) : (
              <div className="flex-1">
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
                  placeholder={t('chat.placeholder')}
                  maxLength={4000}
                  data-testid="chat-input"
                  className="block max-h-[200px] min-h-[44px] w-full resize-none rounded-xl border border-input bg-card px-4 py-2.5 text-[15px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
            {busy ? (
              <Button type="button" size="icon" variant="outline" className="h-11 w-11 shrink-0 rounded-xl" onClick={cancel} aria-label={t('chat.stop')} title={t('chat.stop')}>
                <Square aria-hidden />
              </Button>
            ) : (
              !voiceMode && (
                <Button
                  type="submit"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-xl"
                  disabled={!text.trim()}
                  aria-label={t('chat.send')}
                  title={t('chat.send')}
                  data-testid="chat-send"
                >
                  <ArrowUp aria-hidden />
                </Button>
              )
            )}
          </form>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Switch id={voiceId} checked={voiceMode} onCheckedChange={(v) => { setVoiceMode(v); if (!v) voice.stopSpeaking(); }} aria-describedby={`${voiceId}-hint`} />
              <Label htmlFor={voiceId} className="text-xs font-medium text-foreground">
                {t('voice.mode')}
              </Label>
              <span id={`${voiceId}-hint`} className="hidden sm:inline">
                {voiceMode ? t('approval.clickOnly') : t('voice.modeHint')}
              </span>
              {voice.speaking && (
                <span className="inline-flex items-center gap-1">
                  <Volume2 className="h-3.5 w-3.5" aria-hidden />
                  {t('voice.speaking')}
                </span>
              )}
            </div>
            <span className="sr-only" role="status">
              {busy ? t('chat.status.streaming') : turns.length > 0 ? t('chat.status.done') : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
