import { describe, expect, it } from 'bun:test';
import type { SessionInfo } from '../../../../shared/protocol.js';
import type { AgentHost } from '../types.js';
import { StreamText } from './stream.js';

describe('StreamText tokens', () => {
  it('adds each message’s output tokens to the running turn', () => {
    const state = { session: { turn: { startedAt: 1, tokens: 0 } } as SessionInfo };
    const host = { state, pushEvent: () => {}, emit: () => {}, setSession: (p: Partial<SessionInfo>) => { state.session = { ...state.session, ...p }; } } as unknown as AgentHost;
    const live = new StreamText(host);
    const ev = (e: object) => live.event(e as Parameters<StreamText['event']>[0]);
    ev({ type: 'message_start', message: { id: 'm1', usage: { output_tokens: 2 } } });
    ev({ type: 'message_delta', usage: { output_tokens: 120 } });
    ev({ type: 'message_start', message: { id: 'm2', usage: { output_tokens: 1 } } });
    ev({ type: 'message_delta', usage: { output_tokens: 30 } });
    expect(state.session.turn?.tokens).toBe(150);
  });
});
