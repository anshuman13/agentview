import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

// The prompts waiting for the CLI process. Each process reads one generation; a new generation ends the old stream.
export class InputQueue {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private gen = 0;

  constructor(private isClosed: () => boolean) {}

  push(msg: SDKUserMessage) {
    this.queue.push(msg);
    this.wake?.();
  }

  // Drops what the CLI has not taken yet; returns how many were not priority messages.
  drop() {
    const n = this.queue.filter((m) => !m.priority).length;
    this.queue = [];
    return n;
  }

  clear() {
    this.queue = [];
  }

  // Ends the current stream: its process is gone or the chat closed.
  release(nextGeneration: boolean) {
    if (nextGeneration) this.gen++;
    this.wake?.();
  }

  stream(): AsyncGenerator<SDKUserMessage> {
    return this.read(this.gen);
  }

  private async *read(gen: number): AsyncGenerator<SDKUserMessage> {
    while (!this.isClosed() && gen === this.gen) {
      if (this.queue.length === 0) {
        await new Promise<void>((r) => (this.wake = r));
        continue;
      }
      yield this.queue.shift()!;
    }
  }
}
