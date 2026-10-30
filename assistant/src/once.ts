const running = new Map<string, Promise<unknown>>();

export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let job = running.get(key) as Promise<T> | undefined;
  if (!job) {
    job = fn().finally(() => running.delete(key));
    running.set(key, job);
  }
  return job;
}

const queues = new Map<string, Promise<unknown>>();

// Runs calls with the same key one after another.
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const job = (queues.get(key) ?? Promise.resolve()).then(fn);
  const tail = job.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return job;
}

// Runs fn every ms, skipping a tick while the last one still runs, and logs a failure under name.
export function loop(name: string, ms: number, fn: () => unknown, now = false) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${name}:`, err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };
  if (now) void tick();
  setInterval(tick, ms).unref();
}
