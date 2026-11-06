import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ItemRow } from '../data/sync';
import { ActionRow } from './ActionRow';

vi.mock('../data', () => ({ useAssistantStore: () => ({ update: vi.fn() }) }));

const html = (status: string) => renderToStaticMarkup(<ActionRow row={{ id: 'a', title: 'Send notes', status } as ItemRow} />);

const chip = (status: string, assignee: string | null, meeting?: object) => renderToStaticMarkup(<ActionRow row={{ id: 'a', title: 'Send notes', status, assignee } as ItemRow} meeting={meeting as never} />);
const m = { id: 'm', profile: 'work', people: 'Ada Lovelace, Bob Ray' };

describe('ActionRow assignee', () => {
  it('shows a Me chip on open rows of a meeting only', () => {
    expect(chip('open', null, m)).toContain('mt-date mt-hov');
    for (const s of ['done', 'suggested', 'unassigned', 'dismissed']) expect(chip(s, null, m)).not.toContain('Assign');
    expect(chip('open', null)).not.toContain('Assign');
  });

  it('shows the first name, always visible, when assigned', () => {
    const h = chip('open', 'Ada Lovelace', m);
    expect(h).toContain('>Ada<');
    expect(h).toContain('Assigned to Ada Lovelace');
    expect(h).not.toContain('mt-date mt-hov');
  });
});

describe('ActionRow swipe', () => {
  it('wraps only open rows in Swipe', () => {
    expect(html('open')).toContain('as-swipe');
    expect(html('suggested')).not.toContain('as-swipe');
    expect(html('done')).not.toContain('as-swipe');
  });
});
