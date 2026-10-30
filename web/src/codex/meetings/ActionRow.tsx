import { useAssistantStore } from '../data';
import { atTime } from '../data/engine';
import type { AssistantStore, Patch } from '../data/store';
import { draftFor } from '../data/meetingMarkdown';
import type { ItemRow } from '../data/sync';
import type { Meeting } from '../data/wiki';
import { PickTime, when } from '../time';
import { Icon } from '../../ui/Icon';
import { haptic } from '../../ui/haptic';
import { copyText, showSnack } from '../view';
import { safeHref } from '../../ui/util';

// Opens Linear's new-issue form filled in; nothing is created until you submit it there.
const linearIssue = (r: ItemRow, m: Meeting) => `https://linear.app/new?${new URLSearchParams({ title: r.title ?? '', description: draftFor(r, m).split('\n').slice(1).join('\n') })}`;

export function confirmAll(store: AssistantStore, rows: ItemRow[]) {
  for (const r of rows) void store.update(r, { status: 'open' });
  showSnack(`${rows.length} added to Today`, () => rows.forEach((r) => void store.update(r, { status: r.status })));
}

export function dismissAll(store: AssistantStore, rows: ItemRow[]) {
  for (const r of rows) void store.update(r, { status: 'dismissed' });
  showSnack(`${rows.length} dismissed`, () => rows.forEach((r) => void store.update(r, { status: r.status })));
}

// An action from a meeting. Suggested ones are kept (Today) or dismissed (Not mine, on the meeting); unassigned ones
// can be taken; dismissed ones restored. Each open one has a date chip.
export function ActionRow({ row, meeting }: { row: ItemRow; meeting?: Meeting }) {
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
  const accept = () => change({ status: 'open' }, 'Added to Today');
  const dismiss = () => change({ status: 'dismissed' }, 'Moved to Not mine');
  const suggestedRows = () => [...document.querySelectorAll<HTMLElement>('.mt-task.suggested')];
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.currentTarget;
    const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
    const yes = e.key === 'y' || e.key === 'Enter';
    const no = e.key === 'n' || e.key === 'Delete' || e.key === 'Backspace';
    if (!step && !yes && !no) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = suggestedRows();
    const i = rows.indexOf(el);
    if (step) return rows[i + step]?.focus();
    if (yes) accept();
    else dismiss();
    let tries = 0;
    const move = () => {
      if (el.isConnected) {
        if (++tries < 20) requestAnimationFrame(move);
        return;
      }
      const left = suggestedRows();
      (left[i] ?? left[i - 1])?.focus();
    };
    requestAnimationFrame(move);
  };
  return (
    <div className={`mt-task ${status}`} {...(status === 'suggested' && { tabIndex: 0, onKeyDown })}>
      {mine && (
        <button className={`as-check${done ? ' on' : ''}`} title={done ? 'Not done' : 'Done'} aria-label={done ? 'Not done' : 'Done'} onClick={() => { haptic(done ? 'tap' : 'success'); change({ status: done ? 'open' : 'done' }, done ? 'Moved back to Today' : 'Done'); }}>
          <Icon name={done ? 'pass-filled' : 'circle-large-outline'} />
        </button>
      )}
      <div className="mt-task-body">
        <div className="mt-task-title">{row.title}</div>
        <div className="as-ctx">
          {(status === 'open' || status === 'suggested') && (
            <PickTime className={`mt-date${at != null && at < Date.now() ? ' late' : ''}`} value={at} title={at != null ? `${at < Date.now() ? 'Overdue' : 'Due'} ${when(at)}, set a date` : 'Set a date'} label={at != null ? when(at) : 'Date'}
              onPick={(t) => change({ at: t }, `Due ${when(t)}`)} />
          )}
          {row.text && <span className="mt-task-why">{row.text}</span>}
        </div>
      </div>
      {meeting && mine && !done && <a className="icon-btn" title="New Linear issue" aria-label="New Linear issue" href={linearIssue(row, meeting)} target="_blank" rel="noreferrer"><Icon name="issues" small /></a>}
      {!meeting && row.source_url && <a className="icon-btn" title="Open source" aria-label="Open source" href={safeHref(row.source_url)} target="_blank" rel="noreferrer"><Icon name="link-external" small /></a>}
      {!meeting && row.draft && <button className="icon-btn" title="Copy draft" aria-label="Copy draft" onClick={() => copyText(row.draft!)}><Icon name="copy" small /></button>}
      {meeting && <button className="icon-btn" title="Copy as message" aria-label="Copy as message" onClick={() => copyText(draftFor(row, meeting))}><Icon name="copy" small /></button>}
      {status === 'suggested' && (
        <div className="mt-task-pick">
          <button className="mt-no" title="Not mine" aria-label="Not mine" onClick={dismiss}><Icon name="close" small /></button>
          <button className="mt-yes" title="Mine, add to Today" aria-label="Mine, add to Today" onClick={accept}><Icon name="check" small /></button>
        </div>
      )}
      {status === 'unassigned' && <button className="btn sm" onClick={() => change({ status: 'open' }, 'Added to Today')}>Take it</button>}
      {status === 'dismissed' && <button className="btn sm" onClick={() => change({ status: 'suggested' }, 'Back to review')}>Restore</button>}
    </div>
  );
}
