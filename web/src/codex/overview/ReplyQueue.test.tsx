import { describe, expect, it, vi } from 'bun:test';
import type { ItemRow } from '../data/sync';
import { askKey, replyQueue, snoozeOptions, staleAsks } from './ReplyQueue';

vi.mock('../data/tasks/engine', () => ({ reviewedSince: (r: { at?: number }) => r.at ?? 0, errorText: String }));
vi.mock('../data', () => ({ useAssistantStore: () => ({}) }));
vi.mock('../useActions', () => ({ useActions: () => ({}) }));

const row = (id: string, tags: string, extra: Partial<ItemRow> = {}) => ({ id, profile: 'work', title: `Ask ${id}`, people: 'Ada', source: 'slack', status: 'open', tags, draft: 'Hello\nthere', source_url: 'https://x.test/t', ...extra }) as ItemRow;

describe('staleAsks', () => {
  const now = 10 * 86400_000;
  const at = (id: string, days: number) => row(id, '', { at: now - days * 86400_000 } as Partial<ItemRow>);

  it('keeps asks older than 3 days in order and counts exactly 3 as fresh', () => {
    const rows = [at('a', 4), at('b', 3), at('c', 1), at('d', 9)];
    expect(staleAsks(rows, now).map((r) => r.id)).toEqual(['a', 'd']);
  });
});

describe('snooze', () => {
  const now = new Date(2026, 10, 6, 10).getTime();
  it('leaves out asks snoozed into the future and keeps past, null and missing ones', () => {
    const ids = replyQueue([row('a', '', { snoozed_until: now + 1 }), row('b', '', { snoozed_until: now - 1 }), row('c', '', { snoozed_until: null }), row('d', '')], now).map((r) => r.id);
    expect(ids.sort()).toEqual(['b', 'c', 'd']);
  });

  it('offers Monday 09:00 from a Friday work ask and the next day for personal, and drops Later today from 15:00', () => {
    const fri = new Date(2026, 10, 6, 10).getTime();
    expect(new Date(snoozeOptions(fri, 'work').at(-1)!.at).getDay()).toBe(1);
    expect(new Date(snoozeOptions(fri, 'personal').at(-1)!.at).getDay()).toBe(6);
    expect(snoozeOptions(fri, 'work').map((o) => o.label)).toContain('Later today, 16:00');
    expect(snoozeOptions(new Date(2026, 10, 6, 15).getTime(), 'work').map((o) => o.label)).not.toContain('Later today, 16:00');
  });
});

describe('askKey', () => {
  const key = (k: string, extra = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, preventDefault: vi.fn(), ...extra }) as unknown as React.KeyboardEvent<HTMLElement>;
  const setup = (a: Partial<{ has: boolean; busy: boolean }> = {}) => {
    const send = vi.fn(async () => {});
    const skip = vi.fn(async () => {});
    return { send, skip, a: { has: true, busy: false, send, skip, ...a } };
  };

  it('s sends a drafted ask and x skips', () => {
    const t = setup();
    expect(askKey(key('s'), t.a)).toBeDefined();
    expect(askKey(key('x'), t.a)).toBeDefined();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.skip).toHaveBeenCalledTimes(1);
  });

  it('ignores s without a draft but still skips on x', () => {
    const t = setup({ has: false });
    expect(askKey(key('s'), t.a)).toBeUndefined();
    askKey(key('x'), t.a);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.skip).toHaveBeenCalledTimes(1);
  });

  it('does nothing while busy or with a modifier held', () => {
    const t = setup({ busy: true });
    askKey(key('s'), t.a);
    askKey(key('x'), t.a);
    askKey(key('x', { metaKey: true }), setup().a);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.skip).not.toHaveBeenCalled();
  });
});
