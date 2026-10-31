import { describe, expect, it } from 'vitest';
import { buildReport } from './report';
import type { ItemRow } from '../data/sync';

const row = (o: Partial<ItemRow>) => ({ id: 'x', profile: 'work', deleted: 0, field_times: '{}', updated_at: 0, title: 't', status: 'open', at: null, ...o }) as ItemRow;

describe('buildReport', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const at = (d: number) => new Date(2026, 9, d, 9).getTime();
  const items = [
    row({ title: 'Shipped', status: 'done', updated_at: at(28) }),
    row({ title: 'Old done', status: 'done', updated_at: at(20) }),
    row({ title: 'Overdue', at: at(20) }),
    row({ title: 'Later', at: at(30) }),
    row({ title: 'Next week', at: at(34) }),
    row({ title: 'Gone', at: at(29), deleted: 1 }),
    row({ title: 'Note', status: 'note', at: at(29) }),
  ];

  it('groups completed and not completed for the week and renders markdown', () => {
    const r = buildReport(items, 'week', 'all', now);
    expect(r.markdown).toBe(`## ${r.title}\n\n### Completed\n- [${new Date(at(28)).toLocaleDateString([], { day: 'numeric', month: 'short' })}] Shipped\n\n### Not completed\n- [${new Date(at(20)).toLocaleDateString([], { day: 'numeric', month: 'short' })}] Overdue\n- [${new Date(at(30)).toLocaleDateString([], { day: 'numeric', month: 'short' })}] Later`);
  });
});
