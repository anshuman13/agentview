import { describe, expect, it } from 'vitest';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { savedSession } from './sessions.js';

const info = (firstPrompt?: string, extra: Partial<SDKSessionInfo> = {}) => ({ sessionId: 's', summary: 'T', lastModified: 1, firstPrompt, ...extra }) as SDKSessionInfo;

describe('savedSession', () => {
  it('single-lines the first prompt and cuts it to 300 characters', () => {
    expect(savedSession(info('fix\n\n  the   bug')).firstPrompt).toBe('fix the bug');
    expect(savedSession(info('x'.repeat(500))).firstPrompt).toHaveLength(300);
  });
  it('omits a missing or blank first prompt', () => {
    expect('firstPrompt' in savedSession(info())).toBe(false);
    expect('firstPrompt' in savedSession(info(' \n '))).toBe(false);
  });
  it('strips leading mentions from an @ summary unless the user named the chat', () => {
    const prompt = '@chat:3f2a also check the importer';
    expect(savedSession(info(prompt, { summary: prompt })).title).toBe('also check the importer');
    expect(savedSession(info(prompt, { summary: '@Mine', customTitle: '@Mine' })).title).toBe('@Mine');
  });
});
