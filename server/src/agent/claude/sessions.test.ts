import { describe, expect, it } from 'vitest';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { savedSession } from './sessions.js';

const info = (firstPrompt?: string) => ({ sessionId: 's', summary: 'T', lastModified: 1, firstPrompt }) as SDKSessionInfo;

describe('savedSession', () => {
  it('single-lines the first prompt and cuts it to 300 characters', () => {
    expect(savedSession(info('fix\n\n  the   bug')).firstPrompt).toBe('fix the bug');
    expect(savedSession(info('x'.repeat(500))).firstPrompt).toHaveLength(300);
  });
  it('omits a missing or blank first prompt', () => {
    expect('firstPrompt' in savedSession(info())).toBe(false);
    expect('firstPrompt' in savedSession(info(' \n '))).toBe(false);
  });
});
