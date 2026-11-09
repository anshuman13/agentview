import { ago } from '../../ui/util';

export function time(at: number) {
  if (Date.now() - at < 3_600_000) return ago(at);
  const d = new Date(at);
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === new Date().toDateString() ? clock : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock}`;
}
