// Helpers for what bun:test's vi lacks.
import { setSystemTime as setBunTime, vi } from 'bun:test';

const realImmediate = globalThis.setImmediate;
const globals = new Map<string, PropertyDescriptor | undefined>();
const envs = new Map<string, string | undefined>();

// Without a time, goes back to the real clock.
export function setSystemTime(at?: Date | number | string) {
  setBunTime(at === undefined ? undefined : new Date(at));
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

// Fake timers freeze every setTimeout, but not setImmediate.
const tick = () => new Promise<void>((r) => realImmediate(r));

// Moves fake time forward in small steps, letting promises and I/O settle between steps.
export async function advanceTimersByTimeAsync(ms: number) {
  await tick();
  for (let left = ms; left > 0; ) {
    const step = Math.min(left, 10);
    vi.advanceTimersByTime(step);
    left -= step;
    await tick();
  }
}

// Counts tries: fake timers also freeze performance.now().
export async function waitFor<T>(check: () => T | Promise<T>, { timeout = 1000, interval = 20 } = {}): Promise<T> {
  for (let left = Math.ceil(timeout / interval); ; left--) {
    try {
      return await check();
    } catch (err) {
      if (left <= 0) throw err;
      if (vi.isFakeTimers()) {
        Bun.sleepSync(interval);
        await tick();
      } else await Bun.sleep(interval);
    }
  }
}
