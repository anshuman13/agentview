import type { ChatEvent } from './protocol.js';

// Duet's tap-to-answer replies, offered while the chat's last word is a finished question from the agent.
export const QUICK_REPLIES = ['Yes, do that', 'No, leave it', 'Tell me more'];

const MAX = 48;
const LEAD = /^(should i|shall i|do you want me to|want me to|would you like me to|can i|could i|or should i|or)\s+/i;

const tidy = (s: string) => {
  const t = s.replace(/\*\*|__|`/g, '').replace(/[?.!,;:\s]+$/, '').replace(/^[\s,]+/, '').replace(LEAD, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};

const fits = (xs: string[]) => xs.length >= 2 && xs.length <= 4 && xs.every((x) => x && x.length <= MAX) && new Set(xs).size === xs.length;

// A list item's name: its bold lead, else the text before a colon or dash, else the whole item.
function itemLabel(item: string) {
  const bold = /^\*\*(.+?)\*\*/.exec(item);
  return tidy(bold ? bold[1] : item.split(/:\s|\s[-–]\s/)[0]);
}

// The choices a question offers: the list right above it, or the parts of an "A or B?" question.
export function questionChoices(text: string): string[] {
  const lines = text.trim().split('\n');
  const ask = lines[lines.length - 1].trim();
  if (!ask.endsWith('?')) return [];
  const items: string[] = [];
  for (let i = lines.length - 2; i >= 0; i--) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(lines[i]);
    if (m) items.unshift(m[1]);
    else if (lines[i].trim() || items.length) break;
  }
  if (items.length) {
    const labels = items.map(itemLabel);
    if (fits(labels)) return labels;
  }
  const sentence = ask.split(/(?<=[.!?])\s+/).pop() ?? ask;
  const parts = sentence.split(/,?\s+or\s+/i).map(tidy);
  return fits(parts) ? parts : [];
}

export function quickReplies(events: ChatEvent[]): string[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user') return [];
    if (e.kind === 'assistant' && !e.parent) {
      if (e.streaming || !e.text.trim().endsWith('?')) return [];
      const choices = questionChoices(e.text);
      return choices.length ? choices : QUICK_REPLIES;
    }
  }
  return [];
}
