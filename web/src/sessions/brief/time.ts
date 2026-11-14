import { clock } from '../../../../shared/util';
import { ago } from '../../ui/util';

export function time(at: number) {
  if (Date.now() - at < 3_600_000) return ago(at);
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString() ? clock(at) : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock(at)}`;
}
