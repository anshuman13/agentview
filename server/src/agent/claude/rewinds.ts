import { replayText } from './tasks.js';

// Maps the prompts we sent to the uuids the CLI saved them under, which a file rewind points at.
export class Rewinds {
  private sent: { id: string; text: string }[] = [];
  private ids = new Map<string, string>();

  get pending() {
    return this.sent.length > 0;
  }

  track(id: string, text: string) {
    this.sent.push({ id, text });
  }

  forgetSent() {
    this.sent = [];
  }

  // The CLI echoes each prompt with the uuid it saved it under.
  note(msg: { uuid?: string; message: { content: unknown } }) {
    const text = replayText(msg.message.content);
    const at = this.sent.findIndex((s) => s.text === text);
    if (at < 0 || !msg.uuid) return;
    this.ids.set(this.sent[at].id, msg.uuid);
    this.sent.splice(0, at + 1);
  }

  uuidOf(id: string) {
    return this.ids.get(id) ?? id.replace(/:\d+$/, '');
  }
}
