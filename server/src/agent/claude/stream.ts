import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';

const STREAM_FLUSH_MS = 80;

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];

// Assistant text as it streams in, sent to the client at most every STREAM_FLUSH_MS per block.
export class LiveText {
  private live = new Map<string, Extract<ChatEvent, { kind: 'assistant' }>>();
  private flush = new Map<string, ReturnType<typeof setTimeout>>();
  private msgId = '';

  constructor(private host: AgentHost) {}

  event(ev: StreamEvent) {
    if (ev.type === 'message_start') this.msgId = ev.message.id;
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      const key = `${this.msgId}:${ev.index}`;
      const live = this.live.get(key);
      if (!live) {
        const e = { id: key, kind: 'assistant' as const, text: ev.delta.text, streaming: true, at: Date.now() };
        this.live.set(key, e);
        this.host.pushEvent(e);
      } else {
        live.text += ev.delta.text;
        if (!this.flush.has(key)) {
          this.flush.set(key, setTimeout(() => {
            this.flush.delete(key);
            this.host.emit({ type: 'event', event: live });
          }, STREAM_FLUSH_MS));
        }
      }
    }
    if (ev.type === 'content_block_stop') this.finish(`${this.msgId}:${ev.index}`);
  }

  // A turn can end before content_block_stop; send the partial text once more as finished so it stops streaming.
  end() {
    for (const key of [...this.live.keys()]) this.finish(key);
  }

  private finish(key: string) {
    clearTimeout(this.flush.get(key));
    this.flush.delete(key);
    const live = this.live.get(key);
    this.live.delete(key);
    if (!live) return;
    live.streaming = false;
    this.host.emit({ type: 'event', event: live });
  }
}
