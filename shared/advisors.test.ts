import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { advisorLoopCommand, advisorLoopGoal, auditPrompt, moveBacklog, parseAudit, specsFromAuditPrompt } from './advisors.js';

const kotlin = readFileSync(new URL('../android/app/src/main/kotlin/no/pradhan/agentview/nativeapp/sessions/AdvisorsUi.kt', import.meta.url), 'utf8');
const kotlinPrompt = (name: string, root: string) => new RegExp(`fun ${name}\\(root: String\\) = "(.*)"$`, 'm').exec(kotlin)?.[1].replaceAll('$root', root);

describe('Android prompts', () => {
  it('match the shared ones', () => {
    expect(kotlinPrompt('auditPrompt', '/w/app')).toBe(auditPrompt('/w/app'));
    expect(kotlinPrompt('specsFromAuditPrompt', '/w/app')).toBe(specsFromAuditPrompt('/w/app'));
    expect(kotlinPrompt('advisorLoopGoal', '/w/app')).toBe(advisorLoopGoal('/w/app'));
  });
});

describe('advisorLoopGoal', () => {
  const goal = advisorLoopGoal('/w/app');

  it('names the root, the rules and stays short', () => {
    expect(goal.length).toBeLessThan(1200);
    for (const w of ['/w/app/.claude/backlog.md', '/w/app/.claude/specs/<slug>.md', 'fewer than 2', 'ROUND: question', 'mcp__agentview__start_build', 'building', 'done', '7 days', 'ROUND: nothing', 'back to proposed, keeping its slug']) expect(goal).toContain(w);
  });

  it('starts a 4h goal with a 70% cap and 5 builds and no stop', () => {
    const cmd = advisorLoopCommand('/w/app', 0);
    expect(cmd).toBe(`/goal every 4h cap 70% builds 5 ${goal}`);
    expect(cmd).not.toContain('until');
  });
});

describe('parseAudit', () => {
  const read = (l: string) => parseAudit(l)[0];

  it('reads a fixed mark and its slug', () => {
    expect(read('1. Home | Tiny tap | high | Enlarge | fixed foo')).toMatchObject({ status: 'fixed', by: 'foo', severity: 'high', fix: 'Enlarge' });
  });

  it('reads open and a missing fifth field as open', () => {
    expect(read('1. Home | Tiny tap | high | Enlarge | open')).toMatchObject({ status: 'open', by: '', fix: 'Enlarge' });
    expect(read('2. Home | Tiny tap | low | Enlarge')).toMatchObject({ status: 'open', by: '' });
  });

  it('keeps an unknown fifth field in the fix and the line open', () => {
    expect(read('1. Home | Tiny tap | med | Enlarge | later')).toMatchObject({ status: 'open', fix: 'Enlarge | later' });
  });
});

describe('moveBacklog', () => {
  const md = '# Backlog\n\n1. a | A | why | proposed\n2. b | B | x | y, z | specced\n\nnote\n3. c | C | w | done\n';

  it('swaps a middle row and renumbers, leaving other lines in place', () => {
    expect(moveBacklog(md, 'b', 'up')).toBe('# Backlog\n\n1. b | B | x | y, z | specced\n2. a | A | why | proposed\n\nnote\n3. c | C | w | done\n');
  });

  it('moves an open row past done rows to the nearest open row', () => {
    const m = '1. a | A | w | proposed\n2. d | D | w | done\n3. b | B | w | proposed\n';
    expect(moveBacklog(m, 'a', 'down')).toBe('1. b | B | w | proposed\n2. d | D | w | done\n3. a | A | w | proposed\n');
    expect(moveBacklog(m, 'b', 'up')).toBe('1. b | B | w | proposed\n2. d | D | w | done\n3. a | A | w | proposed\n');
  });

  it('leaves the text unchanged when no open row lies that way', () => {
    expect(moveBacklog(md, 'b', 'down')).toBe(md);
    const m = '1. d | D | w | done\n2. a | A | w | proposed\n';
    expect(moveBacklog(m, 'a', 'up')).toBe(m);
  });

  it('moves a done row to its direct neighbour', () => {
    expect(moveBacklog(md, 'c', 'up')).toBe('# Backlog\n\n1. a | A | why | proposed\n2. c | C | w | done\n\nnote\n3. b | B | x | y, z | specced\n');
  });

  it('keeps the first row up and the last row down, and returns null for an unknown slug', () => {
    expect(moveBacklog(md, 'a', 'up')).toBe(md);
    expect(moveBacklog(md, 'c', 'down')).toBe(md);
    expect(moveBacklog(md, 'zzz', 'up')).toBeNull();
  });
});
