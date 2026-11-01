const HOUR = 3_600_000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SCAN_DAYS = 400;

export const SCHEDULE_HELP = '"hourly", "daily HH:MM", "weekdays HH:MM", "weekly <day> HH:MM", "once YYYY-MM-DD HH:MM" or a 5-field cron line such as "*/15 0-8 * * 1-5", in the hub\'s local time';

// One cron field as the set of values it allows: *, n, a-b, lists and /steps.
function field(f: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of f.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const lo = m[1] === '*' ? min : +m[2];
    const hi = m[1] === '*' ? max : m[3] != null ? +m[3] : m[4] ? max : lo;
    const step = m[4] ? +m[4] : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function cron(s: string) {
  const f = s.split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, h, dom, mon, dow] = [field(f[0], 0, 59), field(f[1], 0, 23), field(f[2], 1, 31), field(f[3], 1, 12), field(f[4], 0, 7)];
  if (!mi || !h || !dom || !mon || !dow) return null;
  if (dow.has(7)) dow.add(0);
  // As in cron, a day matches either field when both the day of month and the weekday are limited.
  const anyDom = f[2] === '*', anyDow = f[4] === '*';
  const day = (d: Date) => mon.has(d.getMonth() + 1) && (anyDom || anyDow ? dom.has(d.getDate()) && dow.has(d.getDay()) : dom.has(d.getDate()) || dow.has(d.getDay()));
  return { day, hours: [...h].sort((a, b) => a - b), minutes: [...mi].sort((a, b) => a - b) };
}

// The first run after `after`, or null for a schedule it cannot read or a one-off that has passed.
export function nextRun(schedule: string | null, after: number): number | null {
  const s = (schedule ?? '').trim().toLowerCase();
  // Whole local hours a real hour apart, so the repeated hour when clocks go back gets its run too.
  if (s === 'hourly') {
    const d = new Date(after);
    return after - (d.getMinutes() * 60_000 + d.getSeconds() * 1000 + d.getMilliseconds()) + HOUR;
  }
  const once = /^once (\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/.exec(s);
  if (once) {
    const t = new Date(+once[1], +once[2] - 1, +once[3], +once[4], +once[5]).getTime();
    return +once[4] < 24 && +once[5] < 60 && t > after ? t : null;
  }
  const m = /^(daily|weekdays|weekly (sun|mon|tue|wed|thu|fri|sat)) (\d{1,2}):(\d{2})$/.exec(s);
  const c = m ? null : cron(s);
  if (m && (+m[3] > 23 || +m[4] > 59)) return null;
  if (!m && !c) return null;
  const day = c ? c.day : (d: Date) => (m![1] === 'daily' ? true : m![1] === 'weekdays' ? d.getDay() % 6 !== 0 : d.getDay() === DAYS.indexOf(m![2]));
  const hours = c ? c.hours : [+m![3]], minutes = c ? c.minutes : [+m![4]];
  const base = new Date(after);
  for (let i = 0; i < SCAN_DAYS; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (!day(d)) continue;
    for (const h of hours) for (const mi of minutes) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).getTime();
      if (t > after) return t;
    }
  }
  return null;
}

