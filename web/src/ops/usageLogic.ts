import type { UsageAccount, UsageDay, UsageLatest, UsageWindow } from '../../../shared/protocol';

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
export const TOKEN_KINDS = ['input', 'output', 'cacheWrite', 'cacheRead'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export const TOKEN_LABEL: Record<TokenKind, string> = { input: 'Input', output: 'Output', cacheWrite: 'Cache write', cacheRead: 'Cache read' };

const MODEL_LABEL: Record<string, string> = { seven_day_opus: 'Opus', seven_day_sonnet: 'Sonnet', seven_day_oauth_apps: 'OAuth apps' };

const round = (n: number) => Math.round(n * 10000) / 10000;

export type LimitRow = { label: string; pct: number; text: string };
export type Point = { x: number; y: number };
export type DayBar = { day: string; label: string; total: number; parts: number[] };

// "resets in 2h 30m", "resets in 3d 20h"; empty when the reset time is unknown.
export function resetText(resetsAt: number | null, now: number) {
  if (resetsAt == null) return '';
  const m = Math.max(0, Math.round((resetsAt - now) / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  const text = d ? `${d}d ${h}h` : h ? `${h}h ${min}m` : `${min}m`;
  return `resets in ${text}`;
}

const windowRow = (label: string, w: UsageWindow, now: number): LimitRow => ({ label, pct: Math.round(w.pct), text: resetText(w.resetsAt, now) });

// The bars on a card: 5-hour, weekly, per-model weekly, then monthly extra usage.
export function limitRows(latest: UsageLatest | null, now: number): LimitRow[] {
  if (!latest) return [];
  const rows: LimitRow[] = [];
  if (latest.fiveHour) rows.push(windowRow('5-hour', latest.fiveHour, now));
  if (latest.week) rows.push(windowRow('Weekly', latest.week, now));
  for (const m of latest.models) rows.push(windowRow(MODEL_LABEL[m.name] ?? m.name, m, now));
  const x = latest.extra;
  if (x) {
    const text = !x.enabled ? 'off' : x.used != null && x.limit != null ? `${x.used} of ${x.limit}${x.currency ? ` ${x.currency}` : ''}` : '';
    rows.push({ label: 'Extra usage', pct: Math.round(x.pct ?? 0), text });
  }
  return rows;
}

// 7-day line points: x from 0 (a week ago) to 1 (now), y in percent; samples without the window are skipped.
export function seriesLines(series: UsageAccount['series'], now: number) {
  const line = (key: 'fiveHour' | 'week'): Point[] =>
    series.filter((p) => p[key] != null && p.at >= now - WEEK).map((p) => ({ x: round((p.at - (now - WEEK)) / WEEK), y: p[key]! }));
  return { fiveHour: line('fiveHour'), week: line('week') };
}

const dayTotal = (d: UsageDay) => TOKEN_KINDS.reduce((t, k) => t + d[k], 0);

// Stacked bars: each part's height as a share of the busiest day, in TOKEN_KINDS order.
export function dayBars(days: UsageDay[]): DayBar[] {
  const max = Math.max(0, ...days.map(dayTotal));
  return days.map((d) => ({ day: d.day, label: String(Number(d.day.slice(8))), total: dayTotal(d), parts: TOKEN_KINDS.map((k) => (max ? round(d[k] / max) : 0)) }));
}

export const tokenTotals = (days: UsageDay[]) =>
  Object.fromEntries(TOKEN_KINDS.map((k) => [k, days.reduce((t, d) => t + d[k], 0)])) as Record<TokenKind, number>;

export function tokens(n: number) {
  const short = (v: number, unit: string) => `${Math.round(v * 10) / 10}${unit}`;
  return n >= 1e9 ? short(n / 1e9, 'B') : n >= 1e6 ? short(n / 1e6, 'M') : n >= 1e3 ? short(n / 1e3, 'k') : String(n);
}
