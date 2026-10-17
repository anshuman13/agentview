import type { LoopPhase, LoopState } from '../../shared/protocol.js';

export const LOOP_MODELS = { plan: 'claude-opus-5-5', build: 'claude-opus-5-5', test: 'claude-sonnet-5-5' } as const;

export type LoopStep = { phase: LoopPhase; model: string; mode: string; label: string; prompt: string };

export const loopOff = (max = 3): LoopState => ({ on: false, max, round: 0, phase: null });

export function verdictOf(text: string): 'pass' | 'fail' | null {
  const m = [...text.matchAll(/^\s*\**VERDICT:?\**\s*\**(PASS|FAIL)\**/gim)].at(-1);
  return m ? (m[1].toUpperCase() === 'PASS' ? 'pass' : 'fail') : null;
}

export function planStep(task: string): LoopStep {
  return {
    phase: 'plan',
    model: LOOP_MODELS.plan,
    mode: 'plan',
    label: 'Plan',
    prompt: [
      'You are in a plan, build, test loop. Phase 1 of 3: plan. Another model will test your work afterwards.',
      'Investigate what you need, then write a short plan: the changes you will make, and how a tester can verify them (exact commands to run, behaviour to try). Then call ExitPlanMode.',
      '',
      'Task:',
      task,
    ].join('\n'),
  };
}

export function buildStep(): LoopStep {
  return {
    phase: 'build',
    model: LOOP_MODELS.build,
    mode: 'auto',
    label: 'Build',
    prompt: 'Phase 2 of 3: build. Implement the plan fully. Run the project checks yourself (typecheck, tests) before you finish, and end with a short summary of what changed and how to verify it.',
  };
}

export function testStep(round: number, max: number): LoopStep {
  return {
    phase: 'test',
    model: LOOP_MODELS.test,
    mode: 'auto',
    label: `Test ${round}/${max}`,
    prompt: [
      `Phase 3 of 3: test, round ${round} of ${max}. You are a different model acting as the tester. Verify the implementation independently: read the plan and the diff (git diff and git status), run the project tests, typecheck and the commands the plan names, and try the behaviour where practical.`,
      'Do not fix anything and do not edit source files. Report what you checked and what you found.',
      'End your reply with one final line, exactly `VERDICT: PASS` if everything works, or `VERDICT: FAIL` followed by a numbered list of concrete failures and how to reproduce each.',
    ].join('\n'),
  };
}

export function fixStep(report: string): LoopStep {
  return {
    phase: 'build',
    model: LOOP_MODELS.build,
    mode: 'auto',
    label: 'Fix',
    prompt: `Phase 2 again: fix. The tester found these problems:\n\n${report.trim()}\n\nFix them, run the checks again, and end with a short summary.`,
  };
}

export function advance(state: LoopState, result: string): { state: LoopState; step: LoopStep | null; note: string | null } {
  if (!state.on || !state.phase) return { state, step: null, note: null };
  if (state.phase === 'plan') return { state: { ...state, phase: 'build' }, step: buildStep(), note: null };
  if (state.phase === 'build') return { state: { ...state, phase: 'test' }, step: testStep(state.round, state.max), note: null };
  if (state.phase === 'test') {
    const verdict = verdictOf(result);
    if (verdict === 'pass') return { state: { ...state, phase: 'passed' }, step: null, note: `Loop passed: the tester approved after ${state.round} ${state.round === 1 ? 'round' : 'rounds'}` };
    if (state.round >= state.max) return { state: { ...state, phase: 'failed' }, step: null, note: verdict ? `Loop stopped: the tester still found problems after ${state.max} rounds` : `Loop stopped: the tester gave no verdict after ${state.max} rounds` };
    return { state: { ...state, phase: 'build', round: state.round + 1 }, step: fixStep(verdict ? result : `The tester gave no VERDICT line. Its report:\n${result}`), note: null };
  }
  return { state, step: null, note: null };
}
