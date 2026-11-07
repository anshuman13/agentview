import type { Theme } from '../app/theme';

export type Width = 'desktop' | 'phone';

export function parseDesignQuery(search: string): { theme?: Theme; width: Width; bare: boolean } {
  const q = new URLSearchParams(search);
  const theme = q.get('theme');
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : undefined,
    width: q.get('width') === 'phone' ? 'phone' : 'desktop',
    bare: q.has('bare'),
  };
}

export function designSearch(search: string, set: { theme?: Theme; width?: Width }): string {
  const q = new URLSearchParams(search);
  if (set.theme) q.set('theme', set.theme);
  if (set.width) q.set('width', set.width);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function blockLink(origin: string, search: string, hash: string, theme: Theme, width: Width): string {
  const q = new URLSearchParams(search);
  q.delete('bare');
  return `${origin}/design${designSearch(`?${q}`, { theme, width })}#${hash}`;
}
