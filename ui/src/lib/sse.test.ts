import { describe, expect, it } from 'vitest';

import { readSse, SseParser, toChatEvent, type SseMessage } from './sse';

const encoder = new TextEncoder();

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(encoder.encode(ch));
      c.close();
    },
  });
}

describe('SseParser', () => {
  it('parses named events with JSON data', () => {
    const p = new SseParser();
    const out = p.push('event: token\ndata: {"type":"token","text":"Hal"}\n\nevent: done\ndata: {"type":"done"}\n\n');
    expect(out).toEqual([
      { event: 'token', data: '{"type":"token","text":"Hal"}' },
      { event: 'done', data: '{"type":"done"}' },
    ]);
  });

  it('handles chunks split anywhere, including inside fields', () => {
    const text = 'event: cost\ndata: {"eur":0.001}\n\n';
    for (let cut = 1; cut < text.length; cut++) {
      const p = new SseParser();
      const out = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut))];
      expect(out).toEqual([{ event: 'cost', data: '{"eur":0.001}' }]);
    }
  });

  it('accepts CRLF and CR line endings, also when CRLF is split across chunks', () => {
    const p = new SseParser();
    const a = p.push('event: a\r\ndata: 1\r');
    const b = p.push('\n\r\nevent: b\rdata: 2\r\r');
    expect([...a, ...b]).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('joins multi-line data and strips exactly one leading space', () => {
    const p = new SseParser();
    expect(p.push('data:  two spaces\ndata:none\n\n')).toEqual([{ event: 'message', data: ' two spaces\nnone' }]);
  });

  it('ignores comments (keep-alives), unknown fields and empty events', () => {
    const p = new SseParser();
    expect(p.push(': keep-alive\n\nfoo: bar\n\nevent: x\n\n')).toEqual([]);
    // The event name of an empty event does not leak into the next one.
    expect(p.push('data: y\n\n')).toEqual([{ event: 'message', data: 'y' }]);
  });

  it('keeps id and retry', () => {
    const p = new SseParser();
    expect(p.push('id: 7\nretry: 1500\ndata: z\n\n')).toEqual([{ event: 'message', data: 'z', id: '7', retry: 1500 }]);
  });

  it('drops an unterminated message at end of stream', () => {
    const p = new SseParser();
    expect(p.push('data: half')).toEqual([]);
    expect(p.end()).toEqual([]);
  });
});

describe('toChatEvent', () => {
  it('parses JSON and keeps the type', () => {
    expect(toChatEvent({ event: 'token', data: '{"type":"token","text":"x"}' })).toEqual({ type: 'token', text: 'x' });
  });
  it('falls back to the SSE event name for the type', () => {
    expect(toChatEvent({ event: 'memory_used', data: '{"count":2}' })).toEqual({ type: 'memory_used', count: 2 });
  });
  it('returns null for non-JSON data', () => {
    expect(toChatEvent({ event: 'message', data: 'not json' })).toBeNull();
  });
});

describe('readSse', () => {
  it('reads a byte stream, including multi-byte characters split across chunks', async () => {
    const bytes = encoder.encode('event: token\ndata: {"text":"Gehälter"}\n\n');
    const i = bytes.indexOf(0xc3) + 1; // split inside "ä"
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, i));
        c.enqueue(bytes.slice(i));
        c.close();
      },
    });
    const got: SseMessage[] = [];
    await readSse(body, (m) => got.push(m));
    expect(got).toEqual([{ event: 'token', data: '{"text":"Gehälter"}' }]);
  });

  it('delivers messages in order across chunks', async () => {
    const got: string[] = [];
    await readSse(stream(['event: a\ndata: 1\n', '\nevent: b\nda', 'ta: 2\n\n']), (m) => got.push(`${m.event}=${m.data}`));
    expect(got).toEqual(['a=1', 'b=2']);
  });
});
