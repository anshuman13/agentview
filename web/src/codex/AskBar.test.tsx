import { describe, expect, it, vi } from 'vitest';
import { recipes } from './AskBar';
import type { Meeting } from './data/wiki/wiki';

vi.mock('./data', () => ({ useAssistantStore: () => ({}), useCodex: () => ({ meetings: [] }) }));
vi.mock('./data/ask/ask', () => ({ ask: () => true, askText: () => '' }));
vi.mock('./tasks/captureTask', () => ({ captureTask: async () => true }));
vi.mock('../chat/composer/Voice', () => ({ Voice: () => null, useDictation: () => () => {} }));

describe('Composer', () => {
  it('asks the Prep recipe in the profile of the next meeting', () => {
    const now = new Date(2026, 10, 4, 10, 0);
    const next = { id: 'cal:a', profile: 'personal', title: 'Dentist', starts_at: now.getTime() + 1800000, ends_at: null } as unknown as Meeting;
    expect(recipes(next, now)).toEqual([expect.objectContaining({ label: 'Prep next meeting', profile: 'personal' })]);
    expect(recipes(undefined, now)[0].profile).toBeUndefined();
  });
});
