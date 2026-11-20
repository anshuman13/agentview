import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GivenClaims } from './Memory';
import type { Fact } from '../../codex/data/wiki/wiki';

const now = Date.now();
const fact = (o: object) => ({ profile: 'work', text: '', at: now - 60_000, ...o }) as Fact;

describe('GivenClaims', () => {
  it('lists the live Memory claims of the chat profile', () => {
    const facts = [
      fact({ id: 'a', text: 'Ship small diffs' }),
      fact({ id: 'b', text: 'Ask before pushing' }),
      fact({ id: 'c', text: 'Disputed rule', contested: '{"by":"you"}' }),
      fact({ id: 'd', text: 'Personal rule', profile: 'personal' }),
      fact({ id: 'e', text: 'Page rule', page_id: 'pg' }),
    ];
    const html = renderToStaticMarkup(<GivenClaims facts={facts} cwd="/w/repo" onClose={() => {}} />);
    expect(html).toContain('From the wiki');
    expect(html).toContain('New chats get these');
    expect(html.match(/class="ui-row[ "]/g)).toHaveLength(2);
    expect(html).toContain('Ship small diffs');
    expect(html).toContain('Ask before pushing');
    expect(html).not.toContain('Disputed rule');
    expect(html).not.toContain('Personal rule');
    expect(html).not.toContain('Page rule');
  });

  it('is left out with no given claims', () => {
    expect(renderToStaticMarkup(<GivenClaims facts={[]} cwd="/w/repo" onClose={() => {}} />)).toBe('');
  });
});
