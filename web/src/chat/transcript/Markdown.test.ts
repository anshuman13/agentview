import { describe, expect, it } from 'bun:test';
import { md, renderBlocks, splitBlocks } from './md';

const full = (t: string) => md.parse(t, { async: false }) as string;

const samples = [
  '# Title\n\nSome **bold** and `code` text.\n\n## Sub\n\nAnother paragraph.',
  '- one\n- two\n  - nested\n\n- loose item\n\n1. a\n2. b',
  'Before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter',
  '| a | b |\n|---|---|\n| 1 | 2 |\n\ntrailing',
  '[site](https://x.test) and [bad](javascript:alert(1))\n\n<div>raw html</div>\n\n> quote\n> more',
  'unterminated\n\n```py\nprint(1)',
];

describe('Markdown blocks', () => {
  it.each(samples)('matches full parse: %#', text => {
    const blocks = splitBlocks(text);
    expect(blocks).not.toBeNull();
    expect(renderBlocks(blocks!)).toBe(full(text));
  });

  it('falls back to full parse for reference links', () => {
    expect(splitBlocks('See [ref][a].\n\n[a]: https://x.test')).toBeNull();
  });

  it('labels a code block with its language', () => {
    expect(full('```ts\nconst a = 1;\n```')).toContain('<span class="md-lang">ts</span><pre>');
    expect(full('```\nplain\n```')).not.toContain('md-lang');
  });

  it('shows images as links so their URL is not fetched', () => {
    const html = full('![chart](https://x.test/a.png?q=secret)');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://x.test/a.png?q=secret"');
  });
});

describe('file paths in replies', () => {
  it('links paths in inline code and links to the file viewer', () => {
    expect(full('See `/Users/me/notes/plan.md`.')).toContain('<a class="md-file" href="#" data-open="/Users/me/notes/plan.md"><code>/Users/me/notes/plan.md</code></a>');
    expect(full('`web/src/a.ts:12`')).toContain('data-open="web/src/a.ts" data-line="12"');
    expect(full('`data.csv`')).toContain('data-open="data.csv"');
    expect(full('[the plan](~/docs/plan.md)')).toContain('<a class="md-file" href="#" data-open="~/docs/plan.md">the plan</a>');
  });

  it('leaves other code and URLs alone', () => {
    for (const t of ['`x.ts`', '`npm run build`', '`https://x.test/a.md`', '`a.b`', '`foo/bar`']) expect(full(t)).not.toContain('data-open');
    expect(full('[site](https://x.test/a.md)')).toContain('href="https://x.test/a.md"');
  });

  it('keeps a link whose target is not valid percent-encoding', () => {
    expect(full('see [a](100%)')).toContain('>a</a>');
  });
});
