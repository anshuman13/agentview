const MAX = 500;
const cache = new Map<string, string>();

export function mdKey(id: string, text: string) {
  return `${id}\n${text}`;
}

export function cachedHtml(key: string) {
  return cache.get(key);
}

export function storeHtml(key: string, html: string) {
  cache.delete(key);
  cache.set(key, html);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
}
