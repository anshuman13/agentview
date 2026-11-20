import { parseWhen, stripWhen } from './engine';
import { parseRepeat } from './recur';
import { withEstimate } from './plan';

// "#home call mum #errands" is the title "call mum" with the tags home and errands.
const takeTags = (typed: string) => ({ title: typed.replace(/(^|\s)#[\p{L}\d_-]+/gu, '').replace(/\s+/g, ' ').trim(), tags: [...typed.matchAll(/(?:^|\s)#([\p{L}\d_-]+)/gu)].map((m) => m[1].toLowerCase()) });

// How quick add reads a typed task: tags, then a repeat rule, then a date, then an estimate moved to the end of the title.
// A picked date (null for "no time") wins over the typed ones and turns off the repeat rule.
export function parseCapture(typed: string, now: Date, pickedAt?: number | null) {
  const { title: plain, tags } = takeTags(typed);
  const picked = pickedAt !== undefined;
  const rep = picked ? null : parseRepeat(plain, now);
  const w = picked || rep ? null : parseWhen(plain, now);
  const at = picked ? pickedAt : rep?.at ?? w?.at ?? null;
  const title = withEstimate((rep ? rep.title : stripWhen(plain, w) || plain) || typed);
  return { title, at, tags, repeat: rep?.text ?? null };
}
