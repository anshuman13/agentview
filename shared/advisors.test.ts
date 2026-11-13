import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { ADVISOR_LOOP_BUILDS, ADVISOR_LOOP_CAP, ADVISOR_LOOP_EVERY, advisorLoopGoal, auditPrompt, specsFromAuditPrompt } from './advisors.js';
import { goalCommand } from './goalForm.js';

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
    expect(goal.length).toBeLessThan(900);
    for (const w of ['/w/app/.claude/backlog.md', '/w/app/.claude/specs/<slug>.md', 'fewer than 2', 'ROUND: question', '/agentview:build', 'building', 'done', '7 days', 'ROUND: nothing']) expect(goal).toContain(w);
  });

  it('starts a 4h goal with a 70% cap and 5 builds', () => {
    const cmd = goalCommand({ what: goal, every: ADVISOR_LOOP_EVERY, stopIn: null, stopAt: null, capPct: ADVISOR_LOOP_CAP, builds: ADVISOR_LOOP_BUILDS }, 0);
    expect(cmd.startsWith('/goal every 4h cap 70% builds 5 Advisor loop for /w/app')).toBe(true);
  });
});
