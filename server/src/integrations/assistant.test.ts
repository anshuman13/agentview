import { describe, expect, it } from 'vitest';
import { applyHubChanges, type HubRow } from './assistant.js';

const change = (id: string, deleted = false) => ({ table: 'items', id, profile: 'work' as const, deleted, updated_at: 1, fields: { title: id } });

describe('applyHubChanges', () => {
  it('removes a row once a change deletes it', () => {
    const rows = new Map<string, Map<string, HubRow>>();
    applyHubChanges(rows, [change('a'), change('b')]);
    expect(rows.get('items')?.size).toBe(2);
    applyHubChanges(rows, [change('a', true)]);
    expect([...rows.get('items')!.keys()]).toEqual(['work:b']);
  });
});
