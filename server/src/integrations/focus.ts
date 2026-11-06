import { ntfyTopic, pushNtfy } from './notify.js';

const MAX_MS = 25 * 60_000;
const SKEW_MS = 30_000;
let pending: ReturnType<typeof setTimeout> | null = null;

export function cancelFocus() {
  if (pending) clearTimeout(pending);
  pending = null;
}

// One push at `end` (client time in ms) saying the focus timer is done; a new timer replaces the old one.
export function scheduleFocus(title: unknown, end: unknown): { ok: true } | { error: string } {
  if (typeof end !== 'number' || !Number.isFinite(end) || end - Date.now() > MAX_MS + SKEW_MS) return { error: 'end must be within 25 minutes' };
  cancelFocus();
  const wait = end - Date.now();
  if (wait <= 0) return { ok: true };
  const name = typeof title === 'string' ? title.slice(0, 120) : '';
  pending = setTimeout(async () => {
    pending = null;
    if ((await ntfyTopic()) === 'off') return;
    await pushNtfy(`Focus done: ${name || 'Untitled'}`, '', 'Open Codex to log the time', 'http://localhost:7777/?view=assistant');
  }, wait);
  pending.unref();
  return { ok: true };
}
