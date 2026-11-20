import { isRepeat } from '../data/tasks/recur';
import type { ItemRow } from '../data/sync';
import { firstLine } from '../../ui/util';
import { checkItems } from './editor/taskChecklist';

// The meta of a task row after the due text: Repeats, the checklist count ("- [x] done" lines in the notes), or High or Medium on an open row; and a note's first line as its preview, when it has no checklist, no people and is not a bare URL. Shared with the phone (shared/fixtures/task-meta.json).
export function taskMetaParts(row: ItemRow) {
  const isDone = row.status === 'done';
  const checks = checkItems(row.text);
  const first = isRepeat(row.text) ? '' : firstLine(row.text);
  const extra = isRepeat(row.text) ? 'Repeats' : checks.length > 0 ? `${checks.filter((c) => c.done).length}/${checks.length}` : !isDone && row.priority === 3 ? 'High' : !isDone && row.priority === 2 ? 'Medium' : '';
  const preview = row.status === 'note' && !checks.length && !row.people && !/^https?:\/\/\S+$/.test(first) ? first : '';
  return { extra, preview };
}
