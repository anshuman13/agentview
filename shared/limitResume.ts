import type { ChatEvent } from './protocol';

const NOTES = ['Compact', 'Loop ', 'Goal', 'Usage limit', 'Logged out'];
const WOKE_UP = /^\w+ woke up/;

// The last prompt and the time its usage limit resets, while the last note after that prompt carries a reset and no wake-up turn started after it.
export function limitResume(events: ChatEvent[]): { prompt: string; reset: number } | null {
  let prompt: string | undefined;
  let reset: number | undefined;
  for (const e of events) {
    if (e.kind === 'user') {
      prompt = e.text;
      reset = undefined;
    } else if (e.kind === 'system') {
      if (WOKE_UP.test(e.text)) prompt = undefined;
      else if (NOTES.some((p) => e.text.startsWith(p))) reset = e.reset;
    }
  }
  return prompt !== undefined && reset ? { prompt, reset } : null;
}
