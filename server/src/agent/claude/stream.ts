import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost } from '../types.js';
import { LiveText } from '../liveText.js';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];

// The SDK's stream events as live assistant text, one key per message content block.
export class StreamText {
  private text: LiveText;
  private msgId = '';

  constructor(host: AgentHost) {
    this.text = new LiveText(host);
  }

  event(ev: StreamEvent) {
    if (ev.type === 'message_start') this.msgId = ev.message.id;
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') this.text.delta(`${this.msgId}:${ev.index}`, ev.delta.text);
    if (ev.type === 'content_block_stop') this.text.finish(`${this.msgId}:${ev.index}`);
  }

  end() {
    this.text.end();
  }
}
