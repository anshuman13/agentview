// A value loaded at most once per ttl and shared by the callers that arrive while it loads. A failed load is not kept.
// With stale, an expired value is returned at once and refreshed in the background; the first call waits.
export function cached<T>(load: () => Promise<T>, ttl: number, stale = false) {
  let value: { at: number; v: T } | null = null;
  let loading: Promise<T> | null = null;
  // Bumped by clear, so a load that started before it is not stored.
  let gen = 0;
  const reload = () => {
    if (loading) return loading;
    const g = gen;
    const p: Promise<T> = load().then((v) => {
      if (g === gen) value = { at: Date.now(), v };
      return v;
    }).finally(() => loading === p && (loading = null));
    return (loading = p);
  };
  const get = (refresh = false): Promise<T> => {
    if (!value || refresh) return reload();
    if (Date.now() - value.at < ttl) return Promise.resolve(value.v);
    if (!stale) return reload();
    reload().catch(() => undefined);
    return Promise.resolve(value.v);
  };
  const clear = () => {
    gen++;
    value = null;
    loading = null;
  };
  return Object.assign(get, { clear });
}
