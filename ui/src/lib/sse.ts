// A small, spec-following parser for text/event-stream (the HTML "server-sent events" format).
// `POST /api/chat` streams SSE, which EventSource cannot do (it only GETs), so the chat reads
// the body with fetch + ReadableStream and feeds the chunks through this parser.

import type { ChatEvent } from './types';

export interface SseMessage {
  /** `event:` field; "message" when absent. */
  event: string;
  /** All `data:` lines joined with "\n". */
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Incremental parser: push text chunks as they arrive (they may split lines, fields or even
 * CRLF pairs anywhere), get complete messages back.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;
  private retry: number | undefined;
  private pendingCR = false;

  push(chunk: string): SseMessage[] {
    const out: SseMessage[] = [];
    let text = chunk;
    // A CR at the end of the previous chunk may be the first half of a CRLF.
    if (this.pendingCR) {
      this.pendingCR = false;
      if (text.startsWith('\n')) text = text.slice(1);
    }
    this.buffer += text;
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c !== '\n' && c !== '\r') continue;
      const line = this.buffer.slice(start, i);
      if (c === '\r') {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === '\n') i++;
        } else {
          this.pendingCR = true;
        }
      }
      start = i + 1;
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** End of stream: a message without its trailing blank line is discarded (per spec). */
  end(): SseMessage[] {
    this.buffer = '';
    this.reset();
    return [];
  }

  private reset() {
    this.event = '';
    this.data = [];
    this.retry = undefined;
  }

  private line(line: string): SseMessage | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = '';
        return null;
      }
      const msg: SseMessage = { event: this.event || 'message', data: this.data.join('\n') };
      if (this.id !== undefined) msg.id = this.id;
      if (this.retry !== undefined) msg.retry = this.retry;
      this.reset();
      return msg;
    }
    if (line.startsWith(':')) return null; // comment / keep-alive
    const colon = line.indexOf(':');
    let field = line;
    let value = '';
    if (colon >= 0) {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }
    switch (field) {
      case 'event':
        this.event = value;
        break;
      case 'data':
        this.data.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.id = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
    return null;
  }
}

/** Turn an SSE message from the chat stream into a typed chat event (null if not JSON). */
export function toChatEvent(msg: SseMessage): ChatEvent | null {
  try {
    const v = JSON.parse(msg.data) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.type !== 'string') v.type = msg.event;
    return v as unknown as ChatEvent;
  } catch {
    return null;
  }
}

/** Read a fetch Response body as SSE, calling `onMessage` for every complete message. */
export async function readSse(body: ReadableStream<Uint8Array>, onMessage: (m: SseMessage) => void, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      for (const m of parser.push(decoder.decode(value, { stream: true }))) onMessage(m);
    }
    for (const m of parser.push(decoder.decode())) onMessage(m);
    parser.end();
  } finally {
    reader.releaseLock();
  }
}
