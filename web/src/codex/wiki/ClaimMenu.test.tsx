import { describe, expect, it, vi } from 'bun:test';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as chats from '../../sessions/openChat';
import * as menu from '../../ui/Menu';
import type { Fact } from '../data/wiki/wiki';

const RealItem = menu.MenuItem;
const items: ComponentProps<typeof RealItem>[] = [];
const showChat = vi.fn();
vi.mock('../../sessions/openChat', () => ({ ...chats, showChat }));
vi.mock('../../ui/Menu', () => ({
  ...menu,
  Menu: ({ children }: { children: ReactNode }) => <>{children}</>,
  MenuItem: (p: ComponentProps<typeof RealItem>) => { items.push(p); return <RealItem {...p} />; },
}));
const { ClaimMenu } = await import('./ClaimMenu');

const noop = () => {};
const actions = { edit: noop, cite: noop, contest: noop, resolve: noop, retire: noop, restore: noop };
const render = (added_by: string, setOpen = noop) => {
  items.length = 0;
  const fact = { id: 'f1', profile: 'work', text: 'Ship small diffs', at: null, added_by } as Fact;
  return renderToStaticMarkup(<ClaimMenu fact={fact} items={['edit', 'retire']} actions={actions} open setOpen={setOpen} />);
};

describe('ClaimMenu', () => {
  it('opens the chat that proposed a claim in place', () => {
    const setOpen = vi.fn();
    const html = render('claude:s1', setOpen);
    const chat = items.find((i) => i.children === 'Open chat')!;
    expect(chat.href).toBeUndefined();
    expect(html).not.toContain('href=');
    chat.onClick!({} as never);
    expect(showChat).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('has no Open chat on a claim you added', () => {
    render('you');
    expect(items.some((i) => i.children === 'Open chat')).toBe(false);
  });
});
