import type { ChatEvent } from '../../../shared/protocol.js';
import type { AgentHost } from './types.js';

const FLUSH_MS = 80;

type Live = { ev: Extract<ChatEvent, { kind: 'assistant' }>; sent: number; timer?: ReturnType<typeof setTimeout> };

// Assistant text as it streams in, for every provider: only the new text, sent at most every FLUSH_MS per key.
// The event in the session state holds the full text, so an init or a finished event carries all of it.
export class LiveText {
  private live = new Map<string, Live>();

  constructor(private host: Pick<AgentHost, 'pushEvent' | 'emit'>) {}

  delta(key: string, text: string) {
    const live = this.live.get(key);
    if (!live) {
      const ev = { id: key, kind: 'assistant' as const, text, streaming: true, at: Date.now() };
      this.live.set(key, { ev, sent: text.length });
      return this.host.pushEvent(ev);
    }
    live.ev.text += text;
    live.timer ??= setTimeout(() => {
      live.timer = undefined;
      const offset = live.sent;
      live.sent = live.ev.text.length;
      this.host.emit({ type: 'append', id: key, offset, text: live.ev.text.slice(offset) });
    }, FLUSH_MS);
  }

  // Sends the text once more as finished; a final text replaces what streamed, in case a delta was missed. False when nothing streamed.
  finish(key: string, final?: string) {
    const live = this.live.get(key);
    if (!live) return false;
    clearTimeout(live.timer);
    this.live.delete(key);
    if (final !== undefined) live.ev.text = final;
    live.ev.streaming = false;
    this.host.emit({ type: 'event', event: live.ev });
    return true;
  }

  // A turn can end before its blocks finish; the partial text stops streaming.
  end() {
    for (const key of [...this.live.keys()]) this.finish(key);
  }
}
