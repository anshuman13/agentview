import { describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';
import { stubGlobal } from '../../../../testing';

const require = createRequire(import.meta.url);
const react = require('react') as typeof import('react');
vi.mock('react', () => ({ ...react, useRef: <T,>(v: T) => ({ current: v }), useEffect: (run: () => void) => { run(); } }));

// A browser history whose go() lands later and fires popstate, as in Chrome.
const entries: unknown[] = [null];
let at = 0;
let pop: () => void = () => {};
const history = {
  get state() { return entries[at]; },
  get length() { return entries.length; },
  pushState(s: unknown) { entries.splice(at + 1, Infinity, s); at++; },
  go(n: number) { setTimeout(() => { at = Math.max(0, Math.min(entries.length - 1, at + n)); pop(); }); },
  back() { this.go(-1); },
  forward() { this.go(1); },
};
stubGlobal('history', history);
stubGlobal('window', { addEventListener: (_: string, f: () => void) => { pop = f; } });

// A fresh copy: another test file in this process may have set up the shared one against its own window.
const { useBack } = await import('./back.ts?fresh');
// Two timer rounds: a go() fired late under load can still schedule the go() it causes after a single settle timer.
const settle = () => new Promise((r) => setTimeout(() => setTimeout(r, 5), 5));

describe('useBack', () => {
  it('steps back off a closed layer reached with Forward, so the next Back is not lost', async () => {
    const page = vi.fn(), trip = vi.fn();
    useBack(page);
    useBack(trip);
    history.back(); await settle();
    expect(trip).toHaveBeenCalledTimes(1);
    history.forward(); await settle();
    expect(at).toBe(1);
    history.back(); await settle();
    expect(page).toHaveBeenCalledTimes(1);
  });
});
