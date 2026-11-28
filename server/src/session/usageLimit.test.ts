import { describe, expect, test } from 'bun:test';
import { UsageLimit } from './usageLimit.js';
import type { AgentSession } from './session.js';

const fake = (build: { state: string } | undefined) => {
  const sent: string[] = [];
  const s = {
    id: 'c',
    runs: { buildFor: () => build },
    driver: { account: 'main', limitHit: () => 'alt', accounts: () => ['main', 'alt'] },
    setSession: () => {},
    system: () => {},
    sendPrompt: (t: string) => sent.push(t),
  };
  return { u: new UsageLimit(s as unknown as AgentSession), sent };
};

describe('failOver', () => {
  test('a chat goes on under the other account', () => {
    const { u, sent } = fake(undefined);
    u.reset = 1;
    expect(u.failOver()).toBe(true);
    expect(sent).toHaveLength(1);
  });

  test('a running build stays on its account', () => {
    const { u, sent } = fake({ state: 'running' });
    u.reset = 1;
    expect(u.failOver()).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
