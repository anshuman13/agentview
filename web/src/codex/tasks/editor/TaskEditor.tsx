import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTaskDraft } from './draft';
import { useAssistant } from '../../data';
import type { ItemRow } from '../../data/sync';
import { Icon } from '../../../ui/Icon';
import { Button } from '../../../ui/Button';
import { Row } from '../../../ui/Row';
import { Section } from '../../../ui/Section';
import { fitHeight, reveal } from '../../../ui/util';
import { useActions } from '../../useActions';
import { Back } from '../../../app/touch/back';
import { haptic } from '../../../ui/haptic';
import { estimateMin, minutesText, suggestEstimate } from '../../data/tasks/plan';
import { historyOf, historyTime } from '../../data/history';
import { Fold } from '../../Fold';
import { caretLine, RelatedStrip, RelatedToTask } from '../../Related';
import { noteView } from './taskChecklist';
import { md } from '../../../chat/transcript/md';
import { Draft, Links } from '../TaskDraft';
import { TaskChecks } from './TaskChecks';
import { TaskChips } from './TaskChips';
import { TaskMoreMenu } from './TaskMoreMenu';
import { TaskTimeLog } from './TaskTimeLog';

type Props = { row: ItemRow; onClose: () => void; onAsk: (r: ItemRow) => void };

// The open task is a page: title and notes save when they lose focus or the task closes.
export function TaskEditor({ row, onClose, onAsk }: Props) {
  const act = useActions();
  const { store, snap } = useAssistant();
  const draft = useTaskDraft(row, store);
  const { title, setTitle, text, setText, putTitle, putText, save } = draft;
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const suggested = useMemo(() => (row.status === 'open' && estimateMin(title) == null ? suggestEstimate(title, snap.items.filter((r) => !r.deleted && r.profile === row.profile)) : null), [row.status, row.profile, title, snap.items]);
  const view = noteView(text);
  const showArea = editing || !text.trim();
  const html = useMemo(() => (view ? (md.parse(view, { async: false }) as string) : ''), [view]);
  const editNotes = () => setEditing(true);
  const estimate = estimateMin(title);
  const spent = Number(row.spent) || 0;
  const history = historyOf(row);
  const addEstimate = (n: number) => putTitle(`${title.trim()} ~${minutesText(n)}`);
  const then = (f: () => void) => () => { save(); f(); onClose(); };
  useTaskEditorFocus(row, onClose, { titleRef, textRef, editing, showArea, title, text });

  return (
    <div className="wk narrow as-page">
      <Back close={onClose} />
      <header className="wk-head">
        <button className="icon-btn" title="Back to tasks" aria-label="Back" onClick={onClose}><Icon name="arrow-left" /></button>
      </header>
      <div className="wk-scroll" ref={scroller}>
        <div className={`as-edit ${row.profile}`} data-no-swipe>
          <Section label={title.trim() || 'Untitled'} action={
            <span className="as-tt-actions">
              {row.status === 'done' && <Button size="sm" variant="gray" icon="check" onClick={() => act.reopen(row)}>Not done</Button>}
              {row.status !== 'done' && row.status !== 'note' && <Button size="sm" variant="filled" icon="check" onClick={then(() => { haptic('success'); act.done(row); })}>Done</Button>}
              <TaskMoreMenu row={row} draft={draft} suggested={suggested} addEstimate={addEstimate} then={then} onAsk={onAsk} />
            </span>
          } />
          <TaskChips row={row} title={title} text={text} putText={putText} addEstimate={addEstimate} />
          <div className="as-tt-body">
            <div className="as-edit-top">
              <textarea
                ref={titleRef}
                className="as-edit-title"
                rows={1}
                value={title}
                placeholder="Title"
                aria-label="Title"
                enterKeyHint="next"
                onChange={(e) => { setTitle(e.target.value); setTyped((t) => t ?? ''); }}
                onBlur={save}
                onFocus={reveal}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); textRef.current?.focus(); } }}
              />
            </div>
            {showArea && <textarea ref={textRef} className="as-edit-text" rows={1} value={text} placeholder="Description" aria-label="Description" onChange={(e) => { setText(e.target.value); setTyped(caretLine(e.target)); }} onFocus={(e) => { setEditing(true); reveal(e); }} onBlur={() => { setEditing(false); save(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} />}
            {!showArea && view && (
              <div
                className="as-edit-read md"
                role="button"
                tabIndex={0}
                aria-label="Edit description"
                onClick={(e) => { if (!(e.target as HTMLElement).closest('a') && !getSelection()?.toString()) editNotes(); }}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editNotes(); } }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
            <Links text={text} />
            {typed !== null && <RelatedStrip text={`${title}\n${typed}`} profile={row.profile} skip={row.id} />}
            {typed === null && <RelatedToTask row={row} />}
            <TaskChecks text={text} putText={putText} scroller={scroller} />
            {row.draft && row.source === 'slack' && (row.status === 'suggested' || row.status === 'open') && <Draft row={row} store={store} onEdit={(d) => act.edit(row, { draft: d })} />}
            {(row.people || estimate != null || spent > 0) && <div className="as-tt-fine">{estimate != null && <span>~{minutesText(estimate)}</span>}{spent > 0 && <span>{minutesText(spent)} spent</span>}{row.people && <span>{row.people}</span>}</div>}
            <TaskTimeLog row={row} />
            <Fold id="task-history" title="History" count={history.length} remember={false}>
              <div className="as-tt-hist">
                {history.map((h) => <Row key={h.field} disabled title={h.title} meta={historyTime(h.at)} />)}
              </div>
            </Fold>
          </div>
        </div>
      </div>
    </div>
  );
}

type FocusTargets = { titleRef: RefObject<HTMLTextAreaElement | null>; textRef: RefObject<HTMLTextAreaElement | null>; editing: boolean; showArea: boolean; title: string; text: string };

function useTaskEditorFocus(row: ItemRow, onClose: () => void, { titleRef, textRef, editing, showArea, title, text }: FocusTargets) {
  useLayoutEffect(() => { fitHeight(titleRef.current); fitHeight(textRef.current); }, [title, text, showArea]);
  useEffect(() => {
    const el = textRef.current;
    if (!editing || !el || document.activeElement === el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  // On desktop the title takes focus, so keys go to the task; the phone keeps its keyboard down until a tap.
  useEffect(() => { if (matchMedia('(hover: hover)').matches) titleRef.current?.focus({ preventScroll: true }); }, []);
  // Closing by key or button puts focus back on the task's row.
  useEffect(() => () => {
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (!at || at === document.body) document.querySelector<HTMLElement>(`[data-row="${row.profile}${row.id}"]`)?.focus();
    });
  }, [row.profile, row.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
}
