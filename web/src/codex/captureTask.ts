import type { AssistantStore } from './data/store';
import { errorText } from './data/engine';
import type { ItemRow, Profile } from './data/sync';
import { haptic } from '../ui/haptic';
import { saveFlag } from '../ui/util';
import { when } from './time';
import { showSnack } from './view';

// Saves a task, remembers the profile for the next one, buzzes and shows "Task · when" with Undo; on failure it says why
// and returns null. extra is patched on after the capture (priority, tags, remind).
export async function captureTask(store: AssistantStore, text: string, profile: Profile, at: number | null, extra: Partial<ItemRow> = {}): Promise<ItemRow | null> {
  try {
    const row = await store.capture(text, 'task', profile, at);
    if (Object.keys(extra).length) await store.update(row, extra);
    saveFlag('assistant-personal', profile === 'personal');
    haptic('tap');
    showSnack(at != null ? `Task · ${when(at)}` : 'Task · No time', () => void store.update(row, { deleted: 1 }));
    return row;
  } catch (err) {
    showSnack(`Not saved: ${errorText(err)}`);
    return null;
  }
}
