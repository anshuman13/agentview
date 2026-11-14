import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { stubGlobal } from '../../../testing';

const react = createRequire(import.meta.url)('react') as typeof import('react');
const { useSyncExternalStore } = react;
vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) }));

const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
stubGlobal('document', doc);
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

const { AdvisorBoard } = await import('./AdvisorBoard');

const item = (slug: string, rank: number) => ({ slug, rank, title: `Title ${slug}`, why: `Why ${slug}`, status: 'proposed' }) as never;

describe('advisor board', () => {
  it('shows Ask PM to rank in Ideas when there is no backlog and no specs', () => {
    const html = renderToStaticMarkup(<AdvisorBoard root="/r" backlog={[]} specs={[]} audit={null} />);
    expect(html).toContain('No backlog yet');
    expect(html).toContain('Ask PM to rank');
    expect(html).toContain('Nothing here');
  });

  it('lists backlog cards with Spec it as the action', () => {
    const html = renderToStaticMarkup(<AdvisorBoard root="/r" backlog={[item('a', 1), item('b', 2)]} specs={[]} audit={null} />);
    expect(html).not.toContain('No backlog yet');
    expect(html).toContain('Title a');
    expect(html).toContain('Title b');
    expect(html).toContain('>Spec it<');
  });

  it('shows the load failure and the skeleton', () => {
    expect(renderToStaticMarkup(<AdvisorBoard root="/r" backlog={null} specs={[]} audit={null} />)).toContain('Could not load the board');
    expect(renderToStaticMarkup(<AdvisorBoard root="/r" backlog={undefined} specs={undefined} audit={null} />)).toContain('skeleton');
  });
});
