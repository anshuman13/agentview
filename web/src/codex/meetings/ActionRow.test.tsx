import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ItemRow } from '../data/sync';
import { ActionRow } from './ActionRow';

vi.mock('../data', () => ({ useAssistantStore: () => ({ update: vi.fn() }), useAssistant: () => ({ store: { update: vi.fn() } }) }));

const render = (status: string, extra: Partial<ItemRow> = {}, meeting?: object) => renderToStaticMarkup(<ActionRow row={{ id: 'a', title: 'Send notes', status, ...extra } as ItemRow} meeting={meeting as never} />);
const m = { id: 'm', profile: 'work', people: 'Ada Lovelace, Bob Ray' };

describe('ActionRow', () => {
  it('shows one small button per status, plus the kebab', () => {
    const labels = { open: 'Done', suggested: 'Mine', unassigned: 'Take it', dismissed: 'Restore', done: 'Not done' };
    for (const [s, label] of Object.entries(labels)) {
      const h = render(s, {}, m);
      expect(h.match(/class="btn btn-\w+ btn-sm/g)).toHaveLength(1);
      expect(h).toContain(`>${label}</button>`);
      expect(h).toContain('aria-label="More"');
    }
  });

  it('shows the assignee first name as plain meta, not a chip', () => {
    const h = render('open', { assignee: 'Ada Lovelace' }, m);
    expect(h).toContain('>Ada<');
    expect(h).not.toContain('mt-date');
    expect(render('open', {}, m)).not.toContain('ui-row-meta');
  });

  it('shows at most one badge, for state only', () => {
    const badges = (h: string) => [...h.matchAll(/class="badge[^"]*"[^>]*>([^<]*)</g)].map((b) => b[1]);
    expect(badges(render('suggested', { at: 1 }, m))).toEqual(['Needs you']);
    expect(badges(render('open', { at: 1 }, m))).toEqual(['Late']);
    expect(badges(render('done', { at: 1 }, m))).toEqual(['Done']);
    expect(badges(render('open', {}, m))).toEqual([]);
  });
});

describe('ActionRow swipe', () => {
  it('wraps only open rows in Swipe', () => {
    expect(render('open')).toContain('as-swipe');
    expect(render('suggested')).not.toContain('as-swipe');
    expect(render('done')).not.toContain('as-swipe');
  });
});
