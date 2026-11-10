import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabBar } from './TabBar';
import { rowCounts } from '../store/counts';

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});

const render = () => renderToStaticMarkup(<TabBar tab="chat" more={false} inChats={false} inMore={false} goTab={() => {}} goSide={() => {}} toggleMore={() => {}} />);

describe('TabBar', () => {
  it('lists every tab and marks only the selected one active', () => {
    const html = render();
    for (const name of ['Codex', 'Chat', 'Sessions', 'Agents', 'More']) expect(html).toContain(`<span>${name}</span>`);
    expect(html.match(/class="active"/g)).toHaveLength(1);
    expect(html).toMatch(/class="active"><i[^>]*><\/i><span>Chat/);
  });

  it('shows the Codex dot while something needs you and none at zero', () => {
    rowCounts.set({ needsYouRows: 1, replyRows: 0 });
    expect(render()).toContain('1 need you');
    rowCounts.set({ needsYouRows: 0, replyRows: 0 });
    expect(render()).not.toContain('need you');
  });
});
