import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Run } from '../data/wiki/wiki';
import { stubGlobal } from '../../../../testing';

stubGlobal('window', {});

const { RunRow } = await import('./RunsSheet');
await import('../../chat/transcript/md');

const run = { id: 'r1', job_id: 'j1', status: 'ok', started_at: 1, output: '## Done\n\n- one\n- two' } as Run;
const render = (query: string) => renderToStaticMarkup(<RunRow r={run} latest query={query} setQuery={() => {}} />);

describe('RunRow', () => {
  it('shows the output as Markdown while the search is blank', () => {
    const html = render('');
    expect(html).toContain('<h2');
    expect(html).toContain('<li');
    expect(html).not.toContain('<mark');
    expect(html).toMatch(/<button[^>]*>.*Copy output<\/button>/);
  });

  it('leaves file paths in the output as plain code', () => {
    const html = renderToStaticMarkup(<RunRow r={{ ...run, output: 'Wrote `notes/plan.md` and [the log](logs/run.md)' }} latest query="" setQuery={() => {}} />);
    expect(html).toContain('<code>notes/plan.md</code>');
    expect(html).not.toContain('data-open');
  });

  it('shows plain marked text once a query is typed', () => {
    const html = render('done');
    expect(html).toContain('<mark>Done</mark>');
    expect(html).toContain('1 match');
    expect(html).not.toContain('<h2');
  });
});
