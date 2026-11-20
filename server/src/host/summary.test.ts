import { describe, expect, it } from 'bun:test';
import type { PendingRequest } from '../../../shared/protocol.js';
import { askLabel } from './summary.js';

const permission = (toolName: string): PendingRequest => ({ id: 'p', kind: 'permission', toolName, title: '', input: {}, canAlwaysAllow: true });

describe('askLabel', () => {
  it('names what the first request asks', () => {
    expect(askLabel(undefined)).toBeUndefined();
    expect(askLabel({ id: 'q', kind: 'question', questions: [] })).toBe('Question');
    expect(askLabel(permission('Bash'))).toBe('Permission: Bash');
    expect(askLabel(permission('ExitPlanMode'))).toBe('Plan approval');
    expect(askLabel(permission('mcp__agentview__data_write'))).toBe('Permission: data_write');
  });
});
