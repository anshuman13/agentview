import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskEditor } from './TaskEditor';
import type { ItemRow } from './data/sync';

vi.mock('./focus', () => ({ useFocus: () => null, isFocused: () => false, startFocus: () => {}, stopFocus: () => {} }));
vi.mock('./data', () => ({ useAssistant: () => ({ store: {}, snap: { items: [], meetings: [], phase: 'ready' } }) }));
vi.mock('./useActions', () => ({ useActions: () => ({}) }));
vi.mock('./Related', () => ({ caretLine: () => '', RelatedStrip: () => null, RelatedToTask: () => null }));
vi.mock('./Goals', () => ({ GoalPick: () => null }));

const row = (over: Partial<ItemRow> = {}) => ({ id: 't', profile: 'work', title: 'Plan trip', status: 'open', at: null, ...over }) as unknown as ItemRow;
const render = (r: ItemRow) => renderToStaticMarkup(<TaskEditor row={r} onClose={() => {}} onAsk={() => {}} />);

describe('TaskEditor', () => {
  it('shows only the title, Done, More and Add on a bare task', () => {
    const html = render(row());
    expect(html).toContain('>Done<');
    expect(html).toContain('aria-label="More"');
    expect(html).toContain('>Add<');
    for (const gone of ['aria-label="Priority"', 'aria-label="Repeat"', 'as-tt-bar', 'as-tt-fine', 'Time log', 'History', 'Add tag']) expect(html).not.toContain(gone);
  });

  it('adds a chip for each value that is set', () => {
    expect(render(row({ priority: 3 }))).toContain('aria-label="Priority"');
    expect(render(row({ tags: 'home' }))).toContain('#home');
    expect(render(row({ text: 'Repeats: every weekday at 09:00\nnotes' }))).toContain('aria-label="Repeat"');
  });

  it('hides Add on a note', () => {
    expect(render(row({ status: 'note' }))).not.toContain('>Add<');
  });
});
