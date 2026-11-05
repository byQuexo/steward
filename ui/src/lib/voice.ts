// Voice mode. "browser": Web Speech API (recognition + speechSynthesis), nothing leaves the
// browser except the recognized text. "server": MediaRecorder → /api/voice/transcribe and
// /api/voice/speak (the profile's STT/TTS models). Approvals are never given by voice.

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import { errorMessage } from './utils';

// Minimal Web Speech API typings (not in TypeScript's DOM lib).
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceState = 'idle' | 'listening' | 'transcribing';

export interface VoiceErrors {
  unsupported: string;
  denied: string;
  failed: (error: string) => string;
}

export function voiceSupported(mode: string): boolean {
  if (typeof window === 'undefined') return false;
  if (mode === 'server') return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  return recognitionCtor() !== null;
}

/** Pick a synthesis voice for `language` (exact tag first, then the language prefix). */
export function pickVoice(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | undefined {
  const tag = language.toLowerCase();
  const prefix = tag.slice(0, 2);
  return (
    voices.find((v) => v.lang.toLowerCase() === tag && v.localService) ??
    voices.find((v) => v.lang.toLowerCase() === tag) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  );
}

export function useVoice(mode: string, language: string, errors: VoiceErrors) {
  const [state, setState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const supported = voiceSupported(mode);

  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef('');
  const endResolve = useRef<((text: string) => void) | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  const start = useCallback(async () => {
    setError(null);
    setInterim('');
    finalText.current = '';
    if (!supported) {
      setError(errorsRef.current.unsupported);
      return;
    }
    if (mode === 'server') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = MediaRecorder.isTypeSupported?.('audio/webm') ? 'audio/webm' : '';
        const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        chunks.current = [];
        r.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.current.push(e.data);
        };
        recorder.current = r;
        r.start();
        setState('listening');
      } catch (e) {
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? errorsRef.current.denied : errorsRef.current.failed(errorMessage(e)));
        setState('idle');
      }
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = language;
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        if (res.isFinal) finalText.current += res[0].transcript;
        else interimText += res[0].transcript;
      }
      setInterim((finalText.current + interimText).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(e.error === 'not-allowed' ? errorsRef.current.denied : errorsRef.current.failed(e.error));
    };
    r.onend = () => {
      setState('idle');
      rec.current = null;
      const resolve = endResolve.current;
      endResolve.current = null;
      resolve?.(finalText.current.trim());
    };
    rec.current = r;
    try {
      r.start();
      setState('listening');
    } catch (e) {
      setError(errorsRef.current.failed(errorMessage(e)));
    }
  }, [language, mode, supported]);

  /** Stop listening; resolves with the recognized text (empty if nothing). */
  const stop = useCallback(async (): Promise<string> => {
    if (mode === 'server') {
      const r = recorder.current;
      if (!r) return '';
      recorder.current = null;
      const blob = await new Promise<Blob>((resolve) => {
        r.onstop = () => resolve(new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }));
        r.stop();
      });
      r.stream.getTracks().forEach((tr) => tr.stop());
      if (blob.size === 0) {
        setState('idle');
        return '';
      }
      setState('transcribing');
      try {
        const text = await api.transcribe(blob);
        setInterim(text);
        return text.trim();
      } catch (e) {
        setError(errorsRef.current.failed(errorMessage(e)));
        return '';
      } finally {
        setState('idle');
      }
    }
    const r = rec.current;
    if (!r) return finalText.current.trim();
    return new Promise<string>((resolve) => {
      endResolve.current = resolve;
      r.stop();
    });
  }, [mode]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      stopSpeaking();
      if (mode === 'server') {
        try {
          const blob = await api.speak(clean);
          const url = URL.createObjectURL(blob);
          const a = new Audio(url);
          audio.current = a;
          a.onended = () => {
            URL.revokeObjectURL(url);
            setSpeaking(false);
          };
          setSpeaking(true);
          await a.play();
        } catch (e) {
          setSpeaking(false);
          setError(errorsRef.current.failed(errorMessage(e)));
        }
        return;
      }
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = language;
      const v = pickVoice(window.speechSynthesis.getVoices(), language);
      if (v) u.voice = v;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [language, mode, stopSpeaking],
  );

  useEffect(
    () => () => {
      rec.current?.abort();
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      audio.current?.pause();
    },
    [],
  );

  return { supported, state, interim, error, speaking, start, stop, speak, stopSpeaking, setError };
}
