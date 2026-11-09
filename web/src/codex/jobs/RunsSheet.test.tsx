import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Run } from '../data/wiki/wiki';
import { RunsRow, RunsSheet } from './RunsSheet';

vi.mock('../data', () => ({ useAssistantStore: () => ({}), useAssistantData: () => ({}) }));

const run = (i: number) => ({ id: `r${i}`, profile: 'work', job_id: 'j', status: 'ok', started_at: 1_000_000 - i * 1000, finished_at: 1_005_000 - i * 1000, output: i ? undefined : 'done', deleted: 0 }) as unknown as Run;
const count = (h: string, s: string) => h.split(s).length - 1;

describe('RunsSheet', () => {
  it('shows a dialog with the 10 latest of 12 runs', () => {
    const h = renderToStaticMarkup(<RunsSheet runs={Array.from({ length: 12 }, (_, i) => run(i))} query="" setQuery={() => {}} onClose={() => {}} />);
    expect(h).toContain('role="dialog"');
    expect(count(h, 'class="jb-run"')).toBe(10);
    expect(h).toContain('>10<');
  });
});

describe('RunsRow', () => {
  it('with no run is plain text without a button or chevron', () => {
    const h = renderToStaticMarkup(<RunsRow onOpen={() => {}} />);
    expect(h).toContain('Not run yet');
    expect(h).not.toContain('<button');
    expect(h).not.toContain('chevron');
  });
});
