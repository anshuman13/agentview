import { describe, expect, it } from 'bun:test';
import { ADVISOR_LOOP_CAP, ADVISOR_LOOP_EVERY, advisorLoopGoal } from './advisors.js';
import { goalCommand } from './goalForm.js';

describe('advisorLoopGoal', () => {
  const goal = advisorLoopGoal('/w/app');

  it('names the root, the rules and stays short', () => {
    expect(goal.length).toBeLessThan(900);
    for (const w of ['/w/app/.claude/backlog.md', '/w/app/.claude/specs/<slug>.md', 'fewer than 2', 'ROUND: question', '/agentview:build', 'building', 'done', '7 days', 'ROUND: nothing']) expect(goal).toContain(w);
  });

  it('starts a 4h goal with a 70% cap', () => {
    const cmd = goalCommand({ what: goal, every: ADVISOR_LOOP_EVERY, stopIn: null, stopAt: null, capPct: ADVISOR_LOOP_CAP }, 0);
    expect(cmd.startsWith('/goal every 4h cap 70% Advisor loop for /w/app')).toBe(true);
  });
});
