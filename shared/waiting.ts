// What other people owe me: an item or mail with no answer for over 3 workdays (Monday to Friday) is late.
export const LATE_WORKDAYS = 3;

export function isLate(since: number, now: number) {
  const d = new Date(since);
  for (let n = 0; n < LATE_WORKDAYS; ) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() >= 1 && d.getDay() <= 5) n++;
  }
  return now > d.getTime();
}

export const nameRe = /^(?:waiting\s+(?:on|for)\s+([^:,\-\n(]+)|@(\S+))/i;

export const waitingOn = (r: { title: string | null; text: string | null; people: string | null }): string | null => {
  const title = r.title?.trim() ?? '';
  const m = nameRe.exec(title);
  if (m) return (m[1] ?? m[2]).trim() || null;
  const first = r.people?.split(',')[0].trim();
  return first && /\bwaiting\b/i.test(`${title} ${r.text ?? ''}`) ? first : null;
};
