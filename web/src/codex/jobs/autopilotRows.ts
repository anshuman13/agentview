import type { AutopilotState } from '../data/store';
import { clock } from '../tasks/time';
import { dayLabel } from '../data/dates';

export const when = (t: number) => (t >= new Date().setHours(0, 0, 0, 0) ? clock(t) : dayLabel(t, true));
export const day = (d: string) => dayLabel(new Date(`${d}T00:00`).getTime(), true);

export function modeLine(s: AutopilotState, waiting: number) {
  const a = s.config.away;
  if (!s.config.enabled) return 'Off';
  const auto = !!s.config.auto_send;
  const line = s.mode === 'away' ? `Away until ${day(a.to)}` : auto && a.from && a.to ? `Drafts only until ${day(a.from)}` : 'Drafts only';
  const failed = s.replies.filter((r) => r.status === 'error').length;
  return [line, waiting ? `${waiting} waiting for you` : '', failed ? `${failed} failed` : '', auto && s.config.dry_run ? 'Dry run' : ''].filter(Boolean).join(' · ');
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;
const modelName = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');

// What the hub's own Claude runs (scans, drafts, jobs) cost, by model.
export function spendLine(s: AutopilotState) {
  const w = s.spend?.week;
  if (!w?.models.length) return '';
  const by = w.models.map((m) => `${modelName(m.model)} ${usd(m.usd)}`).join(', ');
  const jobs = Object.values(w.jobs ?? {}).reduce((n, v) => n + v, 0);
  return `Hub Claude use: today ${usd(s.spend!.today.usd)} · 7 days ${usd(w.usd)} (${by})${jobs > 0 ? ` · jobs ${usd(jobs)}` : ''}`;
}

export const awayValue = (s: AutopilotState) => {
  const a = s.config.away;
  return a.from && a.to ? `${day(a.from)} to ${day(a.to)}` : 'Off';
};

export const coversValue = (s: AutopilotState) => `${s.config.dms ? 'DMs and ' : ''}${s.covered.length} of ${s.watched.length} channels`;

export function neverValue(s: AutopilotState) {
  const people = [...(s.config.manager ? [s.config.manager] : []), ...s.config.escalate];
  return people.length > 1 ? `${people.length} people` : people[0] ?? 'Nobody';
}

export const modelValue = (s: AutopilotState) => (s.config.model === 'opus' ? 'Opus' : 'Sonnet');

export function activityValue(s: AutopilotState) {
  const h = s.scan;
  const week = s.spend?.week.usd;
  const scan = h?.error && (h.failed ?? 0) >= (h.ok ?? 0) ? `Scan failed ${when(h.failed!)}` : h?.ok ? `Scan ${when(h.ok)}` : '';
  return [scan, week ? `${usd(week)} in 7 days` : ''].filter(Boolean).join(' · ') || 'No scan yet';
}
