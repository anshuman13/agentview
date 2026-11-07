import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayGroup } from './TaskGroup';
import { TaskRow } from './Task';
import type { ItemRow } from './data/sync';

vi.mock('./taskKeys', () => ({ rowKey: () => {} }));
vi.mock('./useActions', () => ({ useActions: () => ({}) }));

const at = (h: number) => new Date(2030, 0, 5, h, 30).getTime();
const task = (id: string, over: Partial<ItemRow> = {}) => ({ id, profile: 'work', title: `Task ${id}`, at: at(9), status: 'open', ...over }) as unknown as ItemRow;
const props = { drag: null, picked: null, onOpen: () => {}, start: () => () => {} };

describe('DayGroup', () => {
  it('lists the rows under one header with no part-of-day header or Add task control', () => {
    const rows = [task('a', { at: at(9) }), task('b', { at: at(14) }), task('c', { at: at(19) })];
    const html = renderToStaticMarkup(<DayGroup d={{ key: 'k', label: 'Tomorrow', day: 1, rows }} {...props} />);
    expect(html).toContain('Tomorrow');
    expect(html).toContain('Task b');
    expect(html).not.toContain('as-part');
    for (const w of ['Anytime', 'Morning', 'Afternoon', 'Evening', 'Add task']) expect(html).not.toContain(w);
  });

  it('renders nothing for an empty day unless a drag is active', () => {
    const d = { key: 'k', label: 'Tomorrow', day: 1, rows: [] };
    expect(renderToStaticMarkup(<DayGroup d={d} {...props} />)).toBe('');
    const drag = { item: task('x'), key: 'workx', title: 'x', x: 0, y: 0, over: null };
    expect(renderToStaticMarkup(<DayGroup d={d} {...props} drag={drag} />)).toContain('Drop here');
  });
});

describe('TaskRow meta', () => {
  it('shows the due time and Repeats only for a repeating task with tags and priority', () => {
    const row = task('r', { text: 'Repeats: daily\n- [ ] a\n- [ ] b', tags: 'home work', priority: 3 });
    const html = renderToStaticMarkup(<TaskRow row={row} inDay onOpen={() => {}} />);
    expect(html).toContain('09:30');
    expect(html).toContain('Repeats');
    expect(html).not.toContain('#home');
    expect(html).not.toContain('High');
    expect(html).not.toContain('0/2');
  });

  it('shows the checklist count when there is no repeat', () => {
    const row = task('c', { text: '- [ ] a\n- [ ] b', priority: 3 });
    expect(renderToStaticMarkup(<TaskRow row={row} inDay onOpen={() => {}} />)).toContain('0/2');
  });
});
