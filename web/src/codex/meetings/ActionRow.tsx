import { useAssistantStore } from '../data';
import { atTime } from '../data/engine';
import type { AssistantStore, Patch } from '../data/store';
import type { ItemRow } from '../data/sync';
import { PickTime, when } from '../time';
import { Icon } from '../../ui/Icon';
import { haptic } from '../../ui/haptic';
import { setView, showSnack } from '../view';

const openMeeting = (r: ItemRow) => setView({ list: 'meetings', open: `${r.profile}:${r.meeting_id}` });

export function confirmAll(store: AssistantStore, rows: ItemRow[]) {
  for (const r of rows) void store.update(r, { status: 'open' });
  showSnack(`${rows.length} added to Today`, () => rows.forEach((r) => void store.update(r, { status: r.status })));
}

// An action from a meeting. Suggested ones are kept (Today) or dismissed (Not mine, on the meeting); unassigned ones
// can be taken; dismissed ones restored. Each open one has a date chip.
export function ActionRow({ row, showMeeting = false }: { row: ItemRow; showMeeting?: boolean }) {
  const store = useAssistantStore();
  const change = (patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof ItemRow]])) as Patch;
    void store.update(row, patch);
    showSnack(text, () => void store.update(row, before));
  };
  const status = row.status ?? '';
  const mine = status === 'open' || status === 'done';
  const done = status === 'done';
  const at = atTime(row.at);
  return (
    <div className={`mt-task ${status}`}>
      {mine && (
        <button className="as-check" title={done ? 'Not done' : 'Done'} aria-label={done ? 'Not done' : 'Done'} onClick={() => { haptic(done ? 'tap' : 'success'); change({ status: done ? 'open' : 'done' }, done ? 'Moved back to Today' : 'Done'); }}>
          <Icon name={done ? 'pass-filled' : 'circle-large-outline'} />
        </button>
      )}
      <div className="mt-task-body">
        <div className="mt-task-title">{row.title}</div>
        <div className="as-ctx">
          {showMeeting && row.meeting_id && <button className="mt-task-from" onClick={() => openMeeting(row)}><Icon name="calendar" small /> {row.people || 'Meeting'}</button>}
          {(status === 'open' || status === 'suggested') && (
            <PickTime className={`mt-date${at != null && at < Date.now() ? ' late' : ''}`} value={at} title="Set a date" label={at != null ? when(at) : 'Date'}
              onPick={(t) => change({ at: t }, `Due ${when(t)}`)} />
          )}
          {row.text && <span className="mt-task-why">{row.text}</span>}
        </div>
      </div>
      {status === 'suggested' && (
        <div className="mt-task-pick">
          <button className="mt-no" title="Not mine" aria-label="Not mine" onClick={() => change({ status: 'dismissed' }, 'Moved to Not mine')}><Icon name="close" small /></button>
          <button className="mt-yes" title="Mine, add to Today" aria-label="Mine, add to Today" onClick={() => change({ status: 'open' }, 'Added to Today')}><Icon name="check" small /></button>
        </div>
      )}
      {status === 'unassigned' && <button className="btn sm" onClick={() => change({ status: 'open' }, 'Added to Today')}>Take it</button>}
      {status === 'dismissed' && <button className="btn sm" onClick={() => change({ status: 'suggested' }, 'Back to review')}>Restore</button>}
    </div>
  );
}
