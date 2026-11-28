import { describe, expect, it } from 'bun:test';
import { canHideView, shownViews, toggleView } from './hiddenViews';

describe('hidden activity bar views', () => {
  const views = [{ id: 'assistant' as const }, { id: 'explorer' as const }, { id: 'chats' as const }, { id: 'github' as const }];

  it('hides and shows a view', () => {
    expect(toggleView([], 'explorer')).toEqual(['explorer']);
    expect(toggleView(['explorer', 'github'], 'explorer')).toEqual(['github']);
  });

  it('never hides Codex or Sessions', () => {
    expect(canHideView('assistant')).toBe(false);
    expect(canHideView('chats')).toBe(false);
    expect(toggleView([], 'chats')).toEqual([]);
    expect(shownViews(views, ['assistant', 'chats', 'github']).map((v) => v.id)).toEqual(['assistant', 'explorer', 'chats']);
  });
});
