const tops = new Map<string, number>();

export const saveScroll = (key: string, top: number) => void tops.set(key, top);

export function takeScroll(key: string) {
  const top = tops.get(key) ?? null;
  tops.delete(key);
  return top;
}

export function clearScroll(list: string) {
  for (const key of tops.keys()) if (key.startsWith(`${list}:`)) tops.delete(key);
}
