const running = new Map<string, Promise<unknown>>();

export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let job = running.get(key) as Promise<T> | undefined;
  if (!job) {
    job = fn().finally(() => running.delete(key));
    running.set(key, job);
  }
  return job;
}
