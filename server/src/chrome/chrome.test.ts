import { beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { frame, hooks, resetFrames, viewers } from './chrome.js';

function viewer() {
  const cbs: (() => void)[] = [];
  const ws = { readyState: WebSocket.OPEN, send: (_s: string, cb: () => void) => void cbs.push(cb) } as unknown as WebSocket;
  viewers.add(ws);
  return {
    sends: () => cbs.length,
    flush: () => cbs.splice(0).forEach((cb) => cb()),
  };
}

let acks: number[] = [];
const ack = (id: number) => ({ session: 's', id });

beforeEach(() => {
  resetFrames();
  acks = [];
  hooks.ack = ({ id }) => void acks.push(id);
});

describe('frame', () => {
  it('skips a viewer at 3 unflushed sends and holds the ack until a callback fires', () => {
    const v = viewer();
    frame('a', ack(1));
    frame('b', ack(2));
    frame('c', ack(3));
    frame('d', ack(4));
    expect(v.sends()).toBe(3);
    expect(acks).toEqual([]);
    v.flush();
    expect(acks.sort()).toEqual([1, 2, 3, 4]);
  });

  it('gives a fresh viewer the next frame while another is capped', () => {
    const slow = viewer();
    for (let i = 0; i < 4; i++) frame('x');
    expect(slow.sends()).toBe(3);
    const fresh = viewer();
    frame('y');
    expect(fresh.sends()).toBe(1);
    expect(slow.sends()).toBe(3);
  });

  it('keeps feeding a fast viewer while a slow one is capped, acking after both flush', () => {
    const slow = viewer();
    const fast = viewer();
    for (let i = 1; i <= 3; i++) frame('x', ack(i));
    fast.flush();
    expect(acks).toEqual([]);
    frame('y', ack(4));
    expect(fast.sends()).toBe(1);
    expect(slow.sends()).toBe(3);
    fast.flush();
    expect(acks).toEqual([4]);
    slow.flush();
    expect(acks.sort()).toEqual([1, 2, 3, 4]);
  });

  it('acks a dropped frame on the next drain, and at once with no viewers', () => {
    frame('x', ack(1));
    expect(acks).toEqual([1]);
    const v = viewer();
    for (let i = 0; i < 3; i++) frame('x');
    frame('y', ack(2));
    expect(acks).toEqual([1]);
    frame('z', ack(3));
    expect(acks).toEqual([1, 2]);
    v.flush();
    expect(acks).toEqual([1, 2, 3]);
  });
});
