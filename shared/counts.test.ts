import { expect, it } from 'bun:test';
import { agentGroup } from './counts';

it('groups live chats the way Duet groups tasks', () => {
  expect(agentGroup({ tone: 'needs', runNeeds: false, state: 'needs' })).toBe('input');
  expect(agentGroup({ tone: 'idle', runNeeds: true, state: null })).toBe('input');
  expect(agentGroup({ tone: 'running', runNeeds: false, state: 'running' })).toBe('working');
  expect(agentGroup({ tone: 'idle', runNeeds: false, state: 'done' })).toBe('review');
  expect(agentGroup({ tone: 'idle', runNeeds: false, state: null })).toBeNull();
});
