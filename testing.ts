// Test helpers that work under bun test and vitest alike.
import { vi } from 'vitest';

const bun = process.versions.bun ? await import('bun:test') : null;
const realTimeout = globalThis.setTimeout;
const realImmediate = globalThis.setImmediate;
const globals = new Map<string, PropertyDescriptor | undefined>();
const envs = new Map<string, string | undefined>();

// Without a time, goes back to the real clock.
export function setSystemTime(at?: Date | number | string) {
  if (bun) bun.setSystemTime(at === undefined ? undefined : new Date(at));
  else if (at === undefined) vi.useRealTimers();
  else vi.setSystemTime(at);
}

export function stubGlobal(key: string, value: unknown) {
  if (!globals.has(key)) globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
}

export function unstubAllGlobals() {
  for (const [key, d] of globals) d ? Object.defineProperty(globalThis, key, d) : delete (globalThis as Record<string, unknown>)[key];
  globals.clear();
}

export function stubEnv(key: string, value: string | undefined) {
  if (!envs.has(key)) envs.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

export function unstubAllEnvs() {
  for (const [key, v] of envs) v === undefined ? delete process.env[key] : (process.env[key] = v);
  envs.clear();
}

const tick = () => new Promise<void>((r) => (realImmediate ? realImmediate(r) : realTimeout(r, 0)));

// Moves fake time forward in small steps, letting promises and I/O settle between steps.
export async function advanceTimersByTimeAsync(ms: number) {
  if (!bun) return void (await vi.advanceTimersByTimeAsync(ms));
  await tick();
  for (let left = ms; left > 0; ) {
    const step = Math.min(left, 10);
    vi.advanceTimersByTime(step);
    left -= step;
    await tick();
  }
}

export async function waitFor<T>(check: () => T | Promise<T>, { timeout = 1000, interval = 20 } = {}): Promise<T> {
  const end = performance.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (performance.now() > end) throw err;
      await new Promise((r) => realTimeout(r, interval));
    }
  }
}
