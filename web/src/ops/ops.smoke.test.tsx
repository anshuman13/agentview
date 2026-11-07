import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GitHub } from './GitHub';
import { AgentsPane } from '../sessions/AgentsPane';

vi.hoisted(() => {
  const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { search: '', hash: '' });
});

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => react.useSyncExternalStore(subscribe, get, get) };
});

const empties = (html: string) => html.match(/class="ui-empty /g)?.length ?? 0;
const periods = (html: string) => [...html.matchAll(/class="ui-empty-title">([^<]*)</g)].filter((m) => m[1].endsWith('.'));

describe('ops pages on an empty store', () => {
  it.each<[string, () => string, number]>([
    ['Agents', () => renderToStaticMarkup(<AgentsPane selected={null} onSelect={() => {}} />), 1],
    ['GitHub', () => renderToStaticMarkup(<GitHub />), 3],
  ])('%s shows empty states without trailing periods', (_name, render, count) => {
    const html = render();
    expect(empties(html)).toBe(count);
    expect(periods(html)).toEqual([]);
  });
});
