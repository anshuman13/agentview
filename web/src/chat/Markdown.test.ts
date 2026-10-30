import { describe, expect, it } from 'vitest';
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

  it('shows images as links so their URL is not fetched', () => {
    const html = full('![chart](https://x.test/a.png?q=secret)');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://x.test/a.png?q=secret"');
  });
});
