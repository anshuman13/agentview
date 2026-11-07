import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Page } from '../data/wiki';
import { Overview, PageRow } from './WikiIndex';

vi.mock('../data', () => ({ useAssistantStore: () => ({ editRow: vi.fn() }), useCodex: () => ({ pages: [], facts: [] }) }));

const page = (extra: Partial<Page>) => ({ id: 'p1', profile: 'work', title: 'Alpha team', summary: 'What the team owns', section: 'Teams', updated_at: 1_700_000_000_000, ...extra }) as unknown as Page;

describe('WikiIndex', () => {
  it('renders a page row with the title and no meta line', () => {
    const h = renderToStaticMarkup(<PageRow page={page({})} proposed={new Set()} />);
    expect(h).toContain('Alpha team');
    expect(h).not.toContain('Teams');
    expect(h).not.toContain('claim');
    expect(h).not.toContain('updated');
    expect(h).not.toContain('Needs you');
  });

  it('shows the Needs you badge when the page has a proposed claim', () => {
    const h = renderToStaticMarkup(<PageRow page={page({})} proposed={new Set(['p1'])} />);
    expect(h).toContain('Needs you');
  });

  it('renders the Overview card without a meta line', () => {
    const h = renderToStaticMarkup(<Overview page={page({ section: 'overview', title: 'Overview' })} />);
    expect(h).toContain('What the team owns');
    expect(h).not.toContain('claim');
    expect(h).not.toContain('updated');
    expect(h).not.toContain('wk-meta');
  });
});
