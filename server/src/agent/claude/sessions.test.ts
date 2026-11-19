import { describe, expect, it } from 'bun:test';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { lastMessageTime, savedSession } from './sessions.js';

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
  it('cuts a summary to its first line and 80 characters unless the user named the chat', () => {
    expect(savedSession(info('x', { summary: 'y'.repeat(100) })).title).toHaveLength(80);
    expect(savedSession(info('x', { summary: 'first line\nsecond line' })).title).toBe('first line');
    expect(savedSession(info('x', { summary: 'Short' })).title).toBe('Short');
    const long = 'z'.repeat(100);
    expect(savedSession(info('x', { summary: long, customTitle: long })).title).toBe(long);
  });
});

describe('lastMessageTime', () => {
  it('skips bookkeeping lines written after the last message', () => {
    const tail = ['{"type":"user","timestamp":"2026-11-17T18:30:00.000Z"}', '{"type":"assistant","timestamp":"2026-11-17T18:35:12.471Z"}', '{"type":"system","timestamp":"2026-11-18T15:10:00.000Z"}', '{"type":"last-prompt"}', '{"type":"cost-state"}', ''].join('\n');
    expect(lastMessageTime(tail)).toBe(Date.parse('2026-11-17T18:35:12.471Z'));
  });
  it('returns null for a cut first line or no messages', () => {
    expect(lastMessageTime('mp":"x"}\n{"type":"cost-state"}')).toBeNull();
  });
});
