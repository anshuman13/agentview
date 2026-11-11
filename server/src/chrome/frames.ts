import { OPEN, type Peer } from '../http/peer.js';

export type Ack = { session?: string; id: number };
const MAX_UNFLUSHED = 3;
const unflushed = new Map<Peer, number>();
let heldAck: Ack | null = null;

export const viewers = new Set<Peer>();
export const viewport = { w: 0, h: 0 };

export const hooks = {
  ack: (_: Ack) => {},
};

export function forgetViewer(ws: Peer) {
  unflushed.delete(ws);
}

export function resetFrames() {
  viewers.clear();
  unflushed.clear();
  heldAck = null;
}

function releaseHeld() {
  const a = heldAck;
  heldAck = null;
  if (a) hooks.ack(a);
}

// A viewer that stops flushing holds the ack, and so the screencast, until another send callback fires.
export function frame(data: string, ack?: Ack) {
  if (ack) releaseHeld();
  const s = JSON.stringify({ t: 'frame', data, w: viewport.w, h: viewport.h });
  let took = 0;
  let left = 1;
  const settle = () => {
    if (--left === 0 && ack) hooks.ack(ack);
  };
  viewers.forEach((v) => {
    if (v.readyState !== OPEN || (unflushed.get(v) ?? 0) >= MAX_UNFLUSHED) return;
    took++;
    left++;
    unflushed.set(v, (unflushed.get(v) ?? 0) + 1);
    v.send(s, () => {
      if (unflushed.has(v)) unflushed.set(v, unflushed.get(v)! - 1);
      settle();
      releaseHeld();
    });
  });
  if (took) return settle();
  if (!ack) return;
  if ([...viewers].some((v) => v.readyState === OPEN)) heldAck = ack;
  else hooks.ack(ack);
}
