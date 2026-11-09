export const badgeCount = (rows: readonly unknown[]) => rows.length;

export const badgeArg = (count: number) => (Number.isNaN(count) || count < 0 ? 0 : Math.min(Math.floor(count), 99));

export function createBadgeSender(invoke: ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | undefined) {
  let last: number | undefined;
  return (count: number, force = false) => {
    if (!invoke || (!force && count === last)) return;
    last = count;
    try {
      Promise.resolve(invoke('plugin:badge|set_count', { count })).catch(() => undefined);
    } catch {
      return;
    }
  };
}
