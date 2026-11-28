import { describe, expect, it } from 'bun:test';
import type { PendingRequest } from '../../../shared/protocol.js';
import type { AgentSession } from '../session/session.js';
import { askLabel, firstRequest, summary } from './summary.js';

const chat = (text: string, title = '') => ({
  id: 'c1',
  cwd: '/repo',
  title,
  titleFrom: 0,
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
  it('names a side fork from its first question, not the copied history', () => {
    const c = chat('the parent question');
    c.state.events.push({ kind: 'user', text: 'what does this flag do', at: 3 } as never);
    Object.assign(c, { titleFrom: 1 });
    expect(title(c)).toBe('what does this flag do');
    expect(title(chat('the parent question'))).toBe('the parent question');
  });
});

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

describe('firstRequest', () => {
  it('cuts long input strings and keeps the rest', () => {
    const r = { ...permission('Write'), input: { file_path: '/a', content: 'x'.repeat(5000), edits: [{ old_string: 'y'.repeat(4500) }] } };
    const out = firstRequest(r) as Extract<PendingRequest, { kind: 'permission' }>;
    expect(out.input.file_path).toBe('/a');
    expect((out.input.content as string).length).toBe(4002);
    expect(((out.input.edits as { old_string: string }[])[0].old_string).endsWith('…')).toBe(true);
    expect(firstRequest(undefined)).toBeUndefined();
  });
});
