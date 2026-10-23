import { describe, expect, it, vi } from 'vitest';
import { HOLD_AFTER, Outbox, STEER_STALE } from './outbox';

function setup(saved: { v: string | null } = { v: null }) {
  let now = 1_000_000;
  const storage = { get: () => saved.v, set: (v: string) => (saved.v = v) };
  const transmit = vi.fn((_m: object) => true);
  const box = new Outbox(storage, transmit, () => ({ chat: 'current', session: 's-current' }), () => {}, () => now);
  return { box, transmit, saved, tick: (ms: number) => (now += ms) };
}

const to = { chat: 'a', session: 's-a' };

describe('Outbox', () => {
  it('keeps a message sent while disconnected and sends it once the socket is ready', () => {
    const { box, transmit, saved } = setup();
    const cid = box.enqueue({ type: 'prompt', text: 'hi' }, to);
    expect(transmit).not.toHaveBeenCalled();
    expect(JSON.parse(saved.v!)).toHaveLength(1);
    box.ready(1);
    expect(transmit).toHaveBeenCalledWith({ type: 'prompt', text: 'hi', cid, to });
  });

  it('resends with the same cid on a new socket when a half-open one swallowed it', () => {
    const { box, transmit } = setup();
    box.ready(1);
    const cid = box.enqueue({ type: 'prompt', text: 'hi' }, to);
    box.flush();
    expect(transmit).toHaveBeenCalledTimes(1);
    box.lost();
    box.ready(2);
    expect(transmit).toHaveBeenCalledTimes(2);
    expect(transmit.mock.calls[1][0]).toMatchObject({ cid });
  });

  it('survives a reload: a new outbox on the same storage sends what is left', () => {
    const first = setup();
    const cid = first.box.enqueue({ type: 'prompt', text: 'before reload' }, to);
    const second = setup(first.saved);
    second.box.ready(1);
    expect(second.transmit).toHaveBeenCalledWith(expect.objectContaining({ cid, text: 'before reload' }));
  });

  it('drops a message on accepted or duplicate acks, and keeps a rejected one with the reason', () => {
    const { box } = setup();
    box.ready(1);
    const a = box.enqueue({ type: 'prompt', text: 'a' }, to);
    const b = box.enqueue({ type: 'prompt', text: 'b' }, to);
    const c = box.enqueue({ type: 'prompt', text: 'c' }, to);
    box.ack(a, 'accepted');
    box.ack(b, 'duplicate');
    box.ack(c, 'rejected', 'This chat was closed');
    expect(box.entries).toEqual([expect.objectContaining({ cid: c, state: 'rejected', reason: 'This chat was closed' })]);
  });

  it('sends a rejected message again on retry, with the same cid', () => {
    const { box, transmit } = setup();
    box.ready(1);
    const cid = box.enqueue({ type: 'prompt', text: 'a' }, to);
    box.ack(cid, 'rejected', 'nope');
    box.retry(cid);
    expect(transmit).toHaveBeenCalledTimes(2);
    expect(box.entries[0]).toMatchObject({ state: 'pending' });
  });

  it('turns a stale steer into a prompt and holds very old messages', () => {
    const { box, transmit, tick } = setup();
    box.enqueue({ type: 'steer', text: 'stop and do this' }, to);
    tick(STEER_STALE + 1);
    box.ready(1);
    expect(transmit.mock.calls[0][0]).toMatchObject({ type: 'prompt', text: 'stop and do this' });
    box.lost();
    box.enqueue({ type: 'prompt', text: 'old' }, to);
    tick(HOLD_AFTER + 1);
    box.ready(2);
    expect(box.entries.find((e) => 'text' in e.msg && e.msg.text === 'old')).toMatchObject({ state: 'held' });
  });

  it('does not call a message that already went out "not sent" when its ack is late', () => {
    const { box, tick } = setup();
    box.ready(1);
    box.enqueue({ type: 'prompt', text: 'sent once' }, to);
    box.lost();
    tick(HOLD_AFTER + 1);
    box.ready(2);
    expect(box.entries[0]).toMatchObject({ state: 'pending', tried: true });
  });

  it('keeps entries another tab saved instead of overwriting them', () => {
    const saved = { v: null as string | null };
    const a = setup(saved);
    const b = setup(saved);
    const x = a.box.enqueue({ type: 'prompt', text: 'from tab a' }, to);
    const y = b.box.enqueue({ type: 'prompt', text: 'from tab b' }, to);
    expect(JSON.parse(saved.v!).map((e: { cid: string }) => e.cid).sort()).toEqual([x, y].sort());
    b.box.ack(x, 'accepted');
    expect(JSON.parse(saved.v!).map((e: { cid: string }) => e.cid)).toEqual([y]);
  });

  it('sends once and forgets against an older server that never acks', () => {
    const { box, transmit } = setup();
    box.enqueue({ type: 'prompt', text: 'hi' }, to);
    box.sendOnce();
    expect(transmit).toHaveBeenCalledOnce();
    expect(box.entries).toEqual([]);
  });

  it('expires approvals and answers instead of sending them late', () => {
    const { box, transmit, tick } = setup();
    box.enqueue({ type: 'permission', id: 'p1', allow: true }, to);
    tick(6 * 60_000);
    box.ready(1);
    expect(transmit).not.toHaveBeenCalled();
    expect(box.entries[0]).toMatchObject({ state: 'rejected' });
  });

  it('fills in the chat for a message typed before the first init', () => {
    const { box, transmit } = setup();
    box.enqueue({ type: 'prompt', text: 'early' }, { chat: '', session: null });
    box.ready(1);
    expect(transmit.mock.calls[0][0]).toMatchObject({ to: { chat: 'current', session: 's-current' } });
  });

  it('stops at the first message the socket refuses, so order is kept', () => {
    const { box, transmit } = setup();
    box.enqueue({ type: 'prompt', text: 'one' }, to);
    box.enqueue({ type: 'prompt', text: 'two' }, to);
    transmit.mockReturnValueOnce(false);
    box.ready(1);
    expect(transmit).toHaveBeenCalledTimes(1);
  });
});
