import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildList } from '../sessions/Builds';
import type { BuildRow } from '../../../shared/builds';

vi.hoisted(() => {
  const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { search: '', hash: '' });
});

const build = { slug: 'sample-spec', title: 'Sample spec', stage: 'test', state: 'failed', conclusion: 'Tests failed · 1 of 3 criteria', updatedAt: Date.now() } as BuildRow;

describe('page smoke', () => {
  it('Builds shows the empty state with no builds', () => {
    const html = renderToStaticMarkup(<BuildList builds={[]} onOpen={() => {}} />);
    expect(html.match(/class="ui-empty /g)).toHaveLength(1);
    expect(html).toContain('No builds yet');
  });

  it('Builds shows a row with its dot and conclusion', () => {
    const html = renderToStaticMarkup(<BuildList builds={[build]} onOpen={() => {}} />);
    expect(html).toContain('dot bad');
    expect(html).toContain('Tests failed · 1 of 3 criteria');
    expect(html).not.toContain('ui-empty');
  });
});
