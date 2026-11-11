import { describe, expect, it } from 'bun:test';
import { hookLine } from './hooks';

const hook = (over: Partial<Parameters<typeof hookLine>[0]>) => ({ hook_name: 'PreToolUse:Bash', hook_event: 'PreToolUse', outcome: 'error' as const, exit_code: 2, stderr: '', output: '', stdout: '', ...over });

describe('hookLine', () => {
  it('names the tool a hook blocked and why', () => {
    expect(hookLine(hook({ stderr: 'rm is not allowed\nsecond line' }))).toBe('Hook blocked Bash: rm is not allowed');
    expect(hookLine(hook({ hook_name: 'Stop', hook_event: 'Stop' }))).toBe('Hook blocked Stop');
  });

  it('reports other errors by event, and nothing for a hook that ran fine', () => {
    expect(hookLine(hook({ hook_name: 'PostToolUse:Edit', hook_event: 'PostToolUse', exit_code: 1, output: 'lint failed' }))).toBe('PostToolUse hook failed: lint failed');
    expect(hookLine(hook({ outcome: 'success', exit_code: 0 }))).toBeNull();
    expect(hookLine(hook({ outcome: 'cancelled' }))).toBeNull();
  });
});
