import { describe, expect, it } from 'bun:test';
import { pageClaims, type Fact } from './wiki';
import { wikiMarkdown } from './wikiMarkdown';

const fact = (id: string, heading: string | null, text: string, extra: Partial<Fact> = {}): Fact => ({
  id, profile: 'work', version: 0, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0,
  text, item_id: null, superseded_by: null, page_id: 'p', heading, sources: null, at: Date.now(), contested: null, state: null, replaces: null, added_by: null, ...extra,
});
const src = (...labels: string[]) => JSON.stringify(labels.map((label) => ({ kind: 'doc', label })));
const md = (facts: Fact[]) => wikiMarkdown('Page', pageClaims(facts, 'p'));

describe('wikiMarkdown', () => {
  it('writes title, headings, bullets and sources in order', () => {
    const out = md([fact('a', 'One', 'Alpha', { sources: src('X-1', 'X-2'), at: Date.now() }), fact('b', 'Two', 'Beta', { at: Date.now() - 1000 })]);
    expect(out).toBe('# Page\n\n## One\n\n- Alpha\n  Sources: X-1, X-2\n\n## Two\n\n- Beta\n');
  });

  it('drops duplicate source labels', () => {
    expect(md([fact('a', 'One', 'Alpha', { sources: src('X-1', 'X-1') })])).toContain('  Sources: X-1\n');
  });

  it('leaves out proposed claims and headings holding only them, and files headingless claims under Notes', () => {
    const out = md([fact('a', 'One', 'Alpha', { state: 'proposed' }), fact('b', null, 'Beta')]);
    expect(out).not.toContain('Alpha');
    expect(out).not.toContain('## One');
    expect(out).toContain('## Notes\n\n- Beta');
  });

  it('copies every claim past the on-screen window', () => {
    const facts = Array.from({ length: 60 }, (_, i) => fact(`f${i}`, 'One', `Claim ${i}`, { at: Date.now() - i }));
    expect(md(facts).match(/^- /gm)).toHaveLength(60);
  });
});
