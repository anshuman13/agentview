import { contestOf, factTime, live, type Fact, type Page, type Source } from '../data/wiki/wiki';
import { ago } from '../../ui/util';
import { claimActions, type ClaimButton, type ClaimMenuItem } from '../../../../shared/claimActions';

export const SOURCE_ICON: Record<Source['kind'], string> = { meeting: 'calendar', slack: 'comment-discussion', linear: 'issues', pr: 'git-pull-request', doc: 'file', chat: 'comment-discussion' };
export const MEMORY = 'memory';
export const REVIEW = 'review';
export const memoryPage = (facts: Fact[]): Page => ({ id: MEMORY, profile: 'work', version: 0, updated_at: Math.max(0, ...live(facts).filter((f) => !f.page_id).map(factTime)), deleted: 0, field_times: '{}', dirty: 0, title: 'Memory', section: null, summary: 'What Claude remembers about you and your work outside the wiki pages.', sort: 0, state: null });

export function shortDate(t: number, now = Date.now()) {
  if (now - t < 24 * 3600_000) return ago(t, ' ago');
  if (now - t < 48 * 3600_000) return 'yesterday';
  const d = new Date(t);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' }) });
}

export const actionsFor = (fact: Fact, opts?: { stale?: boolean; editing?: boolean; contesting?: boolean }) => claimActions(fact.state, !!contestOf(fact), opts);
export type { ClaimButton, ClaimMenuItem };
