import { createStore } from '../../ui/createStore';
import { save, storedStrings } from '../../ui/util';
import type { View } from './TabBar';

const KEY = 'agentview.hiddenViews';
const FIXED: View[] = ['assistant', 'chats'];

export const canHideView = (id: View) => !FIXED.includes(id);

export const toggleView = (hidden: readonly string[], id: View): string[] =>
  !canHideView(id) ? [...hidden] : hidden.includes(id) ? hidden.filter((v) => v !== id) : [...hidden, id];

export const shownViews = <T extends { id: View }>(views: readonly T[], hidden: readonly string[]) =>
  views.filter((v) => !canHideView(v.id) || !hidden.includes(v.id));

export const hiddenViews = createStore<string[]>(storedStrings(KEY));

export function toggleHiddenView(id: View) {
  const next = toggleView(hiddenViews.get(), id);
  save(KEY, next);
  hiddenViews.set(next);
}
