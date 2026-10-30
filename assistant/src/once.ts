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
