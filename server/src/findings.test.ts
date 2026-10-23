import { describe, expect, it, vi } from 'vitest';
import { dismissFinding, findingKey, getFindings, parseFindings, reviewTarget, saveFindings } from './findings.js';

vi.hoisted(() => (process.env.AGENTVIEW_FINDINGS_DIR = `${process.env.TMPDIR ?? '/tmp'}/agentview-findings-${process.pid}`));

describe('review findings', () => {
  it('knows what a /code-review prompt targets', () => {
    expect(reviewTarget('/code-review 123')).toBe('123');
    expect(reviewTarget('  /code-review')).toBe('local');
    expect(reviewTarget('/code-review --fix')).toBe('local');
    expect(reviewTarget('fix the tests')).toBeNull();
  });

  it('reads a ReportFindings call and drops what it cannot place', () => {
    const list = parseFindings({
      findings: [
        { file: 'a.ts', line: 3, summary: 'Off by one', failure_scenario: 'empty list crashes', verdict: 'CONFIRMED', category: 'correctness' },
        { file: 'b.ts', line: 'x', short_summary: 'No summary field' },
        { file: '', line: 1, summary: 'no file' },
        null,
      ],
    });
    expect(list).toEqual([
      { file: 'a.ts', line: 3, summary: 'Off by one', failure: 'empty list crashes', category: 'correctness', verdict: 'CONFIRMED' },
      { file: 'b.ts', line: 1, summary: 'No summary field' },
    ]);
    expect(parseFindings({})).toEqual([]);
    expect(findingKey(list[0])).toBe('a.ts:3:Off by one');
  });

  it('keeps findings per repo and target and hides dismissed ones for good', async () => {
    const a = { file: 'a.ts', line: 1, summary: 'one' };
    const b = { file: 'b.ts', line: 2, summary: 'two' };
    expect((await saveFindings('/r', '7', [a, b])).findings).toEqual([a, b]);
    expect((await dismissFinding('/r', '7', findingKey(a)))?.findings).toEqual([b]);
    expect((await saveFindings('/r', '7', [a, b])).findings).toEqual([b]);
    expect((await getFindings('/r', 'local'))).toBeNull();
    expect((await getFindings('/r', '7'))?.findings).toEqual([b]);
  });
});
