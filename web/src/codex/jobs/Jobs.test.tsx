import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '../data/wiki';
import { JobRow } from './Jobs';

vi.mock('../data', () => ({ useAssistantStore: () => ({}), useAssistantData: () => ({}) }));
vi.mock('../view', () => ({ setView: () => {}, useView: () => ({}) }));

const count = (h: string, s: string) => h.split(s).length - 1;

describe('JobRow', () => {
  it('shows name, schedule, one badge and a More button only', () => {
    const j = { id: 'j1', profile: 'work', name: 'Morning digest', schedule: 'weekdays 08:00', prompt: 'go', enabled: 0, deleted: 0, next_run_at: null } as unknown as Job;
    const store = {} as never;
    const h = renderToStaticMarkup(<JobRow j={j} runs={[]} now={1_000_000} store={store} enable={() => {}} />);
    expect(h).toContain('Morning digest');
    expect(h).toContain('Weekdays at 08:00');
    expect(count(h, 'class="badge ')).toBe(1);
    expect(count(h, 'aria-label="More"')).toBe(1);
    expect(count(h, '<button')).toBe(2);
    expect(h).not.toContain('Run now');
    expect(h).not.toContain('7 days');
  });
});
