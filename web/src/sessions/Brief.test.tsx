import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnCard } from './Brief';
import type { Turn } from '../chat/transcript/turns';

const turn = (over: Partial<Turn> = {}): Turn => ({
  id: 't1',
  prompt: 'fix it',
  phase: false,
  at: 1,
  files: [{ path: '/w/a.ts', add: 4, del: 1 }],
  commands: [{ id: 'c1', label: 'npm test', done: true }, { id: 'c2', label: 'ls', done: true }],
  commits: [{ hash: 'abcdef1234', subject: 'Fix it' }],
  agents: [{ id: 'a1', label: 'Explore', type: 'Explore', state: 'done' }],
  notes: [],
  blocked: [],
  steps: [],
  ...over,
});

const html = (t: Turn, live: boolean) => renderToStaticMarkup(<TurnCard turn={t} latest={false} live={live} cwd="/w" pending={[]} />);

describe('TurnCard facts', () => {
  it('folds a finished turn into one summary button', () => {
    const out = html(turn(), false);
    expect(out.match(/tc-facts-toggle/g)).toHaveLength(1);
    expect(out).toContain('1 file');
    expect(out).toContain('2 commands');
    expect(out).not.toMatch(/class="tc-(file|commit|agent)[ "]/);
  });

  it('keeps notes outside the summary', () => {
    const out = html(turn({ notes: [{ id: 'n1', text: 'Shipped', kind: 'done' }] }), false);
    expect(out).toContain('tc-note');
    expect(out.indexOf('tc-note')).toBeLessThan(out.indexOf('tc-facts-toggle'));
  });

  it('shows no summary for a turn with only notes', () => {
    const out = html(turn({ files: [], commands: [], commits: [], agents: [], notes: [{ id: 'n1', text: 'Shipped', kind: 'done' }] }), false);
    expect(out).not.toContain('tc-facts-toggle');
  });

  it('shows a live turn expanded', () => {
    const out = html(turn(), true);
    expect(out).toContain('class="tc-file"');
    expect(out).not.toContain('tc-facts-toggle');
  });
});
