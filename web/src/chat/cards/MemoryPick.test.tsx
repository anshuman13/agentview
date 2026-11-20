import { describe, expect, it, vi } from 'bun:test';
import type { ComponentProps, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as data from '../../codex/data';
import * as rowModule from '../../ui/Row';
import type { Fact } from '../../codex/data/wiki/wiki';

const RealRow = rowModule.Row;
const rows: ComponentProps<typeof RealRow>[] = [];
let facts: Fact[] = [];
const store = { editRow: async (_: string, row: Fact, patch: Partial<Fact>) => { facts = facts.map((f) => (f.id === row.id ? { ...f, ...patch } : f)); } };
vi.mock('../../codex/data', () => ({ ...data, useAssistantStore: () => store }));
vi.mock('../../ui/Row', () => ({ Row: (p: ComponentProps<typeof RealRow>) => { rows.push(p); return <RealRow {...p} />; } }));
const { GivenClaims } = await import('./Memory');

const now = Date.now();
const fact = (o: object) => ({ profile: 'work', text: '', at: now - 60_000, ...o }) as Fact;

describe('GivenClaims', () => {
  it('lists the live Memory claims of the chat profile', () => {
    const facts = [
      fact({ id: 'a', text: 'Ship small diffs' }),
      fact({ id: 'b', text: 'Ask before pushing' }),
      fact({ id: 'c', text: 'Disputed rule', contested: '{"by":"you"}' }),
      fact({ id: 'd', text: 'Personal rule', profile: 'personal' }),
      fact({ id: 'e', text: 'Page rule', page_id: 'pg' }),
    ];
    const html = renderToStaticMarkup(<GivenClaims facts={facts} cwd="/w/repo" onClose={() => {}} />);
    expect(html).toContain('From the wiki');
    expect(html).toContain('New chats get these');
    expect(html.match(/class="ui-row[ "]/g)).toHaveLength(2);
    expect(html).toContain('Ship small diffs');
    expect(html).toContain('Ask before pushing');
    expect(html).not.toContain('Disputed rule');
    expect(html).not.toContain('Personal rule');
    expect(html).not.toContain('Page rule');
  });

  it('is left out with no given claims', () => {
    expect(renderToStaticMarkup(<GivenClaims facts={[]} cwd="/w/repo" onClose={() => {}} />)).toBe('');
  });

  it('retires a claim from its More menu', () => {
    facts = [fact({ id: 'a', text: 'Ship small diffs' }), fact({ id: 'b', text: 'Ask before pushing' })];
    rows.length = 0;
    renderToStaticMarkup(<GivenClaims facts={facts} cwd="/w/repo" onClose={() => {}} />);
    const items = (rows.find((r) => r.title === 'Ship small diffs')!.menu as ReactElement<{ children: ReactElement<{ icon: string; children: string; onClick: () => void }>[] }>).props.children;
    expect(items.map((i) => [i.props.icon, i.props.children])).toEqual([['book', 'Open in wiki'], ['archive', 'Retire']]);
    items[1].props.onClick();
    expect(facts.find((f) => f.id === 'a')?.state).toBe('retired');
    const html = renderToStaticMarkup(<GivenClaims facts={facts} cwd="/w/repo" onClose={() => {}} />);
    expect(html).not.toContain('Ship small diffs');
    expect(html).toContain('Ask before pushing');
  });
});
