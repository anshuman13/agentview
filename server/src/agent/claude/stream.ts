import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost } from '../types.js';
import { LiveText } from '../liveText.js';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];

// The SDK's stream events as live assistant text, one key per message content block, and the turn's output tokens.
export class StreamText {
  private text: LiveText;
  private msgId = '';
  private counted = 0;

  constructor(private host: AgentHost) {
    this.text = new LiveText(host);
  }

  event(ev: StreamEvent) {
    if (ev.type === 'message_start') {
      this.msgId = ev.message.id;
      this.counted = 0;
      this.count(ev.message.usage?.output_tokens);
    }
    if (ev.type === 'message_delta') this.count(ev.usage?.output_tokens);
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') this.text.delta(`${this.msgId}:${ev.index}`, ev.delta.text);
    if (ev.type === 'content_block_stop') this.text.finish(`${this.msgId}:${ev.index}`);
  }

  // usage.output_tokens is the message's running total, so only the rise since the last count is added to the turn.
  private count(total: number | null | undefined) {
    const turn = this.host.state.session.turn;
    if (!turn || !total || total <= this.counted) return;
    this.host.setSession({ turn: { ...turn, tokens: turn.tokens + total - this.counted } });
    this.counted = total;
  }

  end() {
    this.text.end();
  }
}
