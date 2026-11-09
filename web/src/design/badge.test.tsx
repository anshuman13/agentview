import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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

const WORDS = ['waiting', 'sent', 'skipped', 'failed', 'done', 'late', 'new', 'running'];

describe('Badge on /design', () => {
  const html = renderToStaticMarkup(<DesignPage />);
  const badges = [...html.matchAll(/<span class="(badge[^"]*)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ classes: m[1].split(' ').slice(1), text: m[2] }));

  it('shows every status word with its own tone class', () => {
    for (const w of WORDS) expect(badges.some((b) => b.text.toLowerCase() === w && b.classes.includes(w)), w).toBe(true);
  });

  it('allows only digits, a status word, a counted word, Needs you or Live', () => {
    expect(badges.length).toBeGreaterThan(WORDS.length);
    for (const { classes, text } of badges) {
      if (/^\d+$/.test(text)) continue;
      const [first, ...rest] = text.split(' ');
      const counted = /^\d+$/.test(first) ? rest.join(' ') : text;
      const tone = classes[0];
      if (counted === 'Needs you' || counted === 'needs you') expect(tone, text).toBe('waiting');
      else if (counted.toLowerCase() === 'live') expect(tone, text).toBe('running');
      else expect(counted.toLowerCase(), text).toBe(tone);
      expect(WORDS, text).toContain(tone);
    }
  });
});

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') ? [join(dir, e.name)] : []));

describe('Badge call sites', () => {
  const root = join(__dirname, '..');
  const digitsOnly = ['ui/Badge.tsx', 'ui/Section.tsx', 'app/shell/ActivityBar.tsx', 'app/shell/EditorTabs.tsx', 'app/shell/TabBar.tsx', 'workspace/gitStatus.tsx', 'workspace/Changes.tsx', 'ops/pulls.tsx', 'codex/nav.tsx', 'codex/Overview.tsx', 'codex/overview/TodayList.tsx', 'sessions/Sessions.tsx', 'sessions/NeedsYou.tsx', 'design/Stories.tsx'];
  const files = sources(root).map((f) => relative(root, f)).filter((f) => !digitsOnly.includes(f));

  it('has no hand-written badge markup outside the digits-only count sites', () => {
    for (const f of files) expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/className="badge|className=\{`badge|badge \$\{/);
  });

  it('passes no tone to CardRow', () => {
    for (const f of files) {
      const src = readFileSync(join(root, f), 'utf8');
      if (src.includes('CardRow')) expect(src, f).not.toMatch(/\btone:/);
    }
  });
});
