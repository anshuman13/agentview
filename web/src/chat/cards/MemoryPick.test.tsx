import { describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as data from '../../codex/data';
import * as rowModule from '../../ui/Row';
import * as buttonModule from '../../ui/Button';
import * as chatApi from '../chatApi';
import type { Fact } from '../../codex/data/wiki/wiki';
import type { MemoryFile } from './memoryLogic';

const RealRow = rowModule.Row;
const RealButton = buttonModule.Button;
const rows: ComponentProps<typeof RealRow>[] = [];
const buttons: ComponentProps<typeof RealButton>[] = [];
let facts: Fact[] = [];
const store = { editRow: async (_: string, row: Fact, patch: Partial<Fact>) => { facts = facts.map((f) => (f.id === row.id ? { ...f, ...patch } : f)); } };
// The next useState calls return these values, so the sheet renders a loaded list without running its fetch; their setters record into `sets`.
const states: unknown[] = [];
const sets: unknown[] = [];
const removed: string[] = [];
const react = createRequire(import.meta.url)('react') as typeof import('react');
vi.mock('react', () => ({
  ...react,
  useState: (init: unknown) => (states.length ? [states.shift(), (v: unknown) => sets.push(v)] : react.useState(init)),
  useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get),
}));
vi.mock('../../codex/data', () => ({ ...data, useAssistantStore: () => store, useAssistantTable: () => [] }));
vi.mock('../../ui/Sheet', () => ({ Sheet: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../../ui/Row',() => ({ Row: (p: ComponentProps<typeof RealRow>) => { rows.push(p); return <RealRow {...p} />; } }));
vi.mock('../../ui/Button', () => ({ ...buttonModule, Button: (p: ComponentProps<typeof RealButton>) => { buttons.push(p); return <RealButton {...p} />; } }));
vi.mock('../chatApi', () => ({ ...chatApi, removeMemory: async (path: string) => { removed.push(path); return { raw: '', lines: [] }; } }));
const { GivenClaims, MemoryPick } = await import('./Memory');

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
    expect(html).toContain('Remember</button>');
    expect(html).not.toContain('Nothing from the wiki yet');
    expect(html.match(/class="ui-row[ "]/g)).toHaveLength(2);
    expect(html).toContain('Ship small diffs');
    expect(html).toContain('Ask before pushing');
    expect(html).not.toContain('Disputed rule');
    expect(html).not.toContain('Personal rule');
    expect(html).not.toContain('Page rule');
  });

  it('says how many claims new chats do not get', () => {
    const many = Array.from({ length: 17 }, (_, i) => fact({ id: `p${i}`, text: `Preference ${i}`, at: now - i * 1000 }));
    const html = renderToStaticMarkup(<GivenClaims facts={many} cwd="/w/repo" onClose={() => {}} />);
    expect(html.match(/class="ui-row[ "]/g)).toHaveLength(15);
    expect(html).toContain('2 more not given: new chats get the 15 newest, up to 1500 characters');
    expect(html).toContain('Open Memory</button>');
    expect(renderToStaticMarkup(<GivenClaims facts={many.slice(0, 3)} cwd="/w/repo" onClose={() => {}} />)).not.toContain('more not given');
  });

  it('says the wiki can feed chats and offers Remember with no given claims', () => {
    const html = renderToStaticMarkup(<GivenClaims facts={[]} cwd="/w/repo" onClose={() => {}} />);
    expect(html).toContain('From the wiki');
    expect(html).toContain('Nothing from the wiki yet');
    expect(html).toContain('Remember</button>');
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

describe('MemoryPick', () => {
  it('marks a memory file not changed in 100 days Stale and shows its age', () => {
    const file: MemoryFile = { path: '/Users/me/.claude/projects/-w-repo/memory/prefs.md', name: 'prefs', description: 'Prefers short replies', text: 'Short.', editable: true, at: now - 100 * 86_400_000 };
    states.push([file]);
    const html = renderToStaticMarkup(<MemoryPick cwd="/w/repo" onClose={() => {}} />);
    expect(html).toContain('Prefers short replies · Memory · .claude · ');
    expect(html).toContain('>Stale<');
  });

  const view = (file: MemoryFile) => {
    states.push([file], file, '', null, null, 0, false);
    buttons.length = 0;
    sets.length = 0;
    renderToStaticMarkup(<MemoryPick cwd="/w/repo" onClose={() => {}} />);
    return buttons.find((b) => b.children === 'Forget');
  };

  it('forgets an editable memory file and goes back to the list', async () => {
    const path = '/Users/me/.claude/projects/-w-repo/memory/prefs.md';
    const forget = view({ path, name: 'prefs', description: '', text: 'Short.', editable: true, at: now });
    expect(forget?.icon).toBe('trash');
    forget!.onClick!({} as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(removed).toEqual([path]);
    expect(sets).toContain(null);
  });

  it('has no Forget on MEMORY.md', () => {
    expect(view({ path: '/Users/me/.claude/projects/-w-repo/memory/MEMORY.md', name: 'MEMORY', description: '', text: '- [prefs](prefs.md)', editable: true, at: now })).toBeUndefined();
  });
});
