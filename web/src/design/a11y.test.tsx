import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRef } from 'react';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { DesignPage } from './Stories';

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

type El = { tag: string; attrs: string; classes: string[]; inner: string };

const text = (html: string) => html.replace(/<[^>]*>/g, '').trim();
const attr = (el: El, name: string) => el.attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const describeEl = (el: El) => `<${el.tag} class="${el.classes.join(' ')}"> "${text(el.inner)}"`;

const elements = (html: string, tags: string[], cls: string): El[] => {
  const out: El[] = [];
  for (const tag of tags) {
    for (const m of html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g'))) {
      const attrs = m[1] ?? '';
      const classes = (attrs.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
      if (!classes.includes(cls)) continue;
      const start = m.index + m[0].length;
      out.push({ tag, attrs, classes, inner: html.slice(start, html.indexOf(`</${tag}>`, start)) });
    }
  }
  return out;
};

const page = () => renderToStaticMarkup(<DesignPage />);

const openMenu = () => renderToStaticMarkup(
  <Menu trigger={createRef()} onClose={() => {}}>
    <MenuItem>Plain</MenuItem>
    <MenuItem icon="edit">With icon</MenuItem>
    <MenuItem href="https://example.com">Link</MenuItem>
    <MenuSeparator />
    <MenuItem icon="trash" danger>Danger</MenuItem>
  </Menu>,
);

describe('design page accessibility', () => {
  const html = page();

  it('names every Row that opens something from its title and meta', () => {
    const rows = elements(html, ['a', 'button'], 'ui-row');
    expect(rows.some((r) => r.tag === 'a')).toBe(true);
    expect(rows.some((r) => r.tag === 'button')).toBe(true);
    expect(elements(html, ['div'], 'ui-row').length).toBeGreaterThan(0);
    for (const row of rows) {
      const title = elements(row.inner, ['span'], 'ui-row-title')[0];
      const titleText = title ? text(title.inner) : '';
      expect(titleText, `Row has no title text: ${describeEl(row)}`).toBeTruthy();
      const meta = elements(row.inner, ['span'], 'ui-row-meta')[0];
      if (meta) expect(text(meta.inner), `Row meta is empty: ${describeEl(row)}`).toBeTruthy();
      expect(text(row.inner)).toContain(titleText);
      if (meta) expect(text(row.inner)).toContain(text(meta.inner));
    }
  });

  it('labels every IconButton', () => {
    const buttons = elements(html, ['button', 'a'], 'icon-btn');
    expect(buttons.some((b) => b.tag === 'a')).toBe(true);
    expect(buttons.some((b) => b.tag === 'button')).toBe(true);
    for (const b of buttons) expect(attr(b, 'aria-label')?.trim(), `IconButton has no aria-label: ${describeEl(b)}`).toBeTruthy();
  });

  it('gives every menu item in the page a menuitem role', () => {
    const items = elements(html, ['button', 'a'], 'ui-menu-item');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(attr(item, 'role'), `Menu item has no role: ${describeEl(item)}`).toBe('menuitem');
  });

  it('renders the same markup twice', () => {
    expect(page()).toBe(html);
  });
});

describe('open menu accessibility', () => {
  const html = openMenu();

  it('has a menu container, menuitem items and a separator', () => {
    expect(elements(html, ['div'], 'ui-menu').map((m) => attr(m, 'role'))).toEqual(['menu']);
    const items = elements(html, ['button', 'a'], 'ui-menu-item');
    expect(items.map((i) => i.tag).sort()).toEqual(['a', 'button', 'button', 'button']);
    for (const item of items) expect(attr(item, 'role'), `Menu item has no role: ${describeEl(item)}`).toBe('menuitem');
    expect(elements(html, ['div'], 'ui-menu-sep').map((s) => attr(s, 'role'))).toEqual(['separator']);
  });

  it('renders the same markup twice', () => {
    expect(openMenu()).toBe(html);
  });
});
