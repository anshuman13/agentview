import { describe, expect, it, vi } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { stubGlobal } from '../../../../testing';

const react = createRequire(import.meta.url)('react') as typeof import('react');
const { useSyncExternalStore } = react;
vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) }));

const { Tasks } = await import('./TaskLines');
const { setShownWork, toggleWork } = await import('../chatActions');

const row = (id: string) => ({ kind: 'fold', id, hidden: [], work: { tools: 3, files: 0, agents: 0, failed: 0, ms: 0, cost: 0, add: 0, del: 0 }, last: true, steps: [], now: '', thought: '', claims: [], proposed: [], remembered: [] }) as never;
const html = (id: string) => renderToStaticMarkup(<Tasks row={row(id)} live={false} />);

describe('tools button', () => {
  it('opens a turn, closes it on a second press and switches to another turn', () => {
    const sent: string[] = [];
    stubGlobal('window', { dispatchEvent: (e: CustomEvent) => sent.push(`${e.type} ${e.detail}`) });
    stubGlobal('CustomEvent', class { constructor(public type: string, init: { detail: string }) { Object.assign(this, init); } });
    expect(html('t1')).toContain('aria-pressed="false"');
    toggleWork('t1');
    setShownWork('rail', 't1');
    expect(html('t1')).toContain('aria-pressed="true"');
    expect(html('t2')).toContain('aria-pressed="false"');
    toggleWork('t1');
    toggleWork('t2');
    expect(sent).toEqual(['open-work t1', 'close-work t1', 'open-work t2']);
    setShownWork('rail', null);
  });
});
