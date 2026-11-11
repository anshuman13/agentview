import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './storyMocks';

const { DesignPage } = await import('./Stories');

const HEADING_NAMES: Record<string, string | null> = { 'Section header': 'Section', 'Grouped list': null };
const EXTRA_PRIMITIVES = ['AskRow'];

const docPrimitives = () => {
  const doc = readFileSync(fileURLToPath(new URL('../../../docs/design-system.md', import.meta.url)), 'utf8');
  const components = doc.split(/^## Components$/m)[1]?.split(/^## /m)[0] ?? '';
  const names = [...components.matchAll(/^### (.+)$/gm)].map((m) => {
    const heading = m[1].replace(/\s*\(.*\)$/, '').trim();
    return heading in HEADING_NAMES ? HEADING_NAMES[heading] : heading.split(' ')[0];
  });
  return [...new Set([...names.filter((n): n is string => !!n), ...EXTRA_PRIMITIVES])];
};

const anchors = (html: string) => [...html.matchAll(/<div id="([^"]*)" class="ds-block-anchor">/g)].map((m) => m[1]);

const blockOf = (html: string, id: string) => {
  const open = `<div id="${id}" class="ds-block-anchor">`;
  const start = html.indexOf(open);
  if (start < 0) return '';
  const next = html.indexOf('" class="ds-block-anchor">', start + open.length);
  return html.slice(start, next < 0 ? undefined : next);
};

const renderIn = (theme: string) => {
  document.documentElement.dataset.theme = theme;
  return renderToStaticMarkup(<DesignPage />);
};

describe('design page stories', () => {
  const primitives = docPrimitives();

  it('reads the primitives from the design doc', () => {
    expect(primitives.length).toBeGreaterThan(0);
    expect(primitives).toEqual(expect.arrayContaining(['Button', 'Row', 'AskRow', 'Section']));
  });

  for (const theme of ['light', 'dark']) {
    it(`has a Block with a story for every primitive in the ${theme} theme`, () => {
      const html = renderIn(theme);
      expect(html).not.toContain('hit an error');
      for (const name of primitives) {
        const block = blockOf(html, name.toLowerCase());
        const hint = `${name} has no story: add a Block to web/src/design/Stories.tsx`;
        expect(block, hint).not.toBe('');
        expect(block, hint).toContain(`<span class="ui-section-label">${name}</span>`);
        expect(block, `${name} Block holds no story`).toMatch(/<div class="ds-block"><[a-z]/);
      }
    });
  }

  it('has a doc entry for every Block, the same Blocks in both themes', () => {
    const light = anchors(renderIn('light'));
    expect(anchors(renderIn('dark'))).toEqual(light);
    const expected = primitives.map((n) => n.toLowerCase());
    for (const id of light) expect(expected, `Block ${id} has no entry in docs/design-system.md`).toContain(id);
  });
});
