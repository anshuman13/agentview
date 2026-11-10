import { describe, expect, it } from 'vitest';
import type { AgentSession } from '../session/session.js';
import { summary } from './summary.js';

const chat = (text: string, title = '') => ({
  id: 'c1',
  cwd: '/repo',
  title,
  created: 1,
  state: { events: [{ kind: 'user', text, at: 2 }], pending: [], status: '', session: { running: false, mcp: [], sessionId: 's1' } },
}) as unknown as AgentSession;

const title = (c: AgentSession) => summary(c, { stalled: false, run: undefined, refresh: () => {} }).title;

describe('summary title', () => {
  it('drops a leading chat mention from the first prompt', () => {
    expect(title(chat('@chat:3f2a9c1e-0000-4000-8000-000000000000 also check the importer'))).toBe('also check the importer');
  });
  it('keeps a title the user set', () => {
    expect(title(chat('@chat:3f2a also check the importer', 'My name'))).toBe('My name');
  });
});
