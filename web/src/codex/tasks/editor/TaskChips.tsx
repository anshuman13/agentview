import { useRef, useState } from 'react';
import { atTime } from '../../data/tasks/engine';
import type { ItemRow } from '../../data/sync';
import { Icon } from '../../../ui/Icon';
import { Chip, chipClass, IconButton } from '../../../ui/Button';
import { Menu, MenuItem } from '../../../ui/Menu';
import { haptic } from '../../../ui/haptic';
import { useActions } from '../../useActions';
import { clock, PickDue } from '../time';
import { estimateMin, minutesText } from '../../data/tasks/plan';
import { cadenceLine, cadenceOf, skipTarget, withRule, type Cadence } from '../../data/tasks/recur';
import { Flag, PRIORITIES, tagList } from '../AddSheet';
import { TagInput } from './TagInput';

const dueLabel = (at: number | null) => {
  if (at == null) return 'No due';
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const time = d.getHours() || d.getMinutes() ? clock(at) : '';
  if (days === 0 || days === 1) return `${days ? 'Tomorrow' : 'Today'}${time ? ` ${time}` : ''}`;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

const REPEAT_LABEL = { never: 'Never', daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' };

type Props = { row: ItemRow; title: string; text: string; putText: (text: string) => void; addEstimate: (n: number) => void };

export function TaskChips({ row, title, text, putText, addEstimate }: Props) {
  const act = useActions();
  const at = atTime(row.at);
  const [flagging, setFlagging] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [adder, setAdder] = useState<'priority' | 'repeat' | 'estimate' | null>(null);
  const [adderOpen, setAdderOpen] = useState(false);
  const [tagging, setTagging] = useState(false);
  const flagBtn = useRef<HTMLButtonElement>(null);
  const repeatBtn = useRef<HTMLButtonElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const tags = tagList(row.tags);
  const setTags = (next: string[]) => act.edit(row, { tags: next.length ? [...new Set(next)].join(' ') : null });
  const cadence = cadenceOf(text, at);
  const estimate = estimateMin(title);
  const skipAt = row.status === 'open' && at != null ? skipTarget(row, Date.now()) : null;
  const timed = row.status === 'open' || row.status === 'suggested' || at != null;
  const repeat = (c: Cadence) => { if (c !== 'custom' && c !== cadence) putText(withRule(text, c === 'never' ? null : cadenceLine(c, at))); };
  const closeAdd = () => { setAdderOpen(false); setAdder(null); };
  const pickPriority = (p: number) => { haptic('tap'); act.edit(row, { priority: p || null }); };
  const priorityItems = (done: () => void) => PRIORITIES.map(([p, l]) => <button key={p} role="menuitemradio" aria-checked={(row.priority ?? 0) === p} className="ui-menu-item as-flag-item" onClick={() => { done(); pickPriority(p); }}><Flag priority={p} /><span>{l} priority</span></button>);
  const repeatItems = (done: () => void) => (
    <>
      {([['never', 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', `Weekly${at != null ? ` on ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}` : ''}`], ['monthly', `Monthly${at != null ? ` on the ${new Date(at).getDate()}` : ''}`]] as const).map(([c, l]) => <MenuItem key={c} role="menuitemradio" aria-checked={cadence === c} onClick={() => { done(); repeat(c); }}>{l}</MenuItem>)}
      {cadence === 'custom' && <MenuItem role="menuitemradio" aria-checked disabled>Custom</MenuItem>}
    </>
  );

  return (
    <div className="as-tags">
      {timed && (
        <PickDue className={chipClass({ quiet: true, late: at != null && at < Date.now() && row.status === 'open' })} value={at} onPick={(t) => t !== at && act.due(row, t)} remind={row.remind ?? null} onRemind={(r) => act.edit(row, { remind: r })} skipAt={skipAt} onSkip={() => skipAt != null && act.skip(row, skipAt)}>
          <Icon name="calendar" small /> {dueLabel(at)}{row.remind != null && at != null && <Icon name={row.remind < 0 ? 'bell-slash' : 'bell'} small />}
        </PickDue>
      )}
      {!!row.priority && (
        <>
          <Chip ref={flagBtn} quiet on aria-label="Priority" title="Priority" aria-haspopup="menu" aria-expanded={flagging} onClick={() => setFlagging(!flagging)}>
            <Flag priority={row.priority} /> {PRIORITIES.find(([p]) => p === row.priority)?.[1]}
          </Chip>
          {flagging && (
            <Menu trigger={flagBtn} className="as-tt-menu" onClose={() => setFlagging(false)}>
              {priorityItems(() => setFlagging(false))}
            </Menu>
          )}
        </>
      )}
      {tags.map((t) => (
        <span key={t} className={chipClass({ quiet: true })}>
          #{t}
          <IconButton icon="close" label={`Remove #${t}`} small onClick={() => setTags(tags.filter((x) => x !== t))} />
        </span>
      ))}
      {cadence !== 'never' && (
        <>
          <Chip ref={repeatBtn} quiet on icon="sync" aria-label="Repeat" title="Repeat" aria-haspopup="menu" aria-expanded={repeating} disabled={row.status !== 'open'} onClick={() => setRepeating(!repeating)}>{REPEAT_LABEL[cadence]}</Chip>
          {repeating && (
            <Menu trigger={repeatBtn} className="as-tt-menu" onClose={() => setRepeating(false)}>
              {repeatItems(() => setRepeating(false))}
            </Menu>
          )}
        </>
      )}
      {tagging && <TagInput onAdd={(v) => setTags([...tags, v])} onClose={() => setTagging(false)} />}
      {!tagging && row.status !== 'note' && (
        <>
          <Chip ref={addBtn} quiet icon="add" aria-haspopup="menu" aria-expanded={adderOpen} onClick={() => { setAdderOpen(!adderOpen); setAdder(null); }}>Add</Chip>
          {adderOpen && (
            <Menu key={adder ?? 'main'} trigger={addBtn} className="as-tt-menu" onClose={closeAdd}>
              {adder ? (
                <>
                  <MenuItem onClick={() => setAdder(null)} icon="arrow-left">{{ priority: 'Priority', repeat: 'Repeat', estimate: 'Estimate' }[adder]}</MenuItem>
                  {adder === 'priority' && priorityItems(closeAdd)}
                  {adder === 'repeat' && repeatItems(closeAdd)}
                  {adder === 'estimate' && [15, 30, 60, 120].map((n) => <MenuItem key={n} disabled={!title.trim()} onClick={() => { closeAdd(); addEstimate(n); }}>{minutesText(n)}</MenuItem>)}
                </>
              ) : (
                <>
                  {!row.priority && <MenuItem onClick={() => setAdder('priority')} icon="flag">Priority</MenuItem>}
                  <MenuItem onClick={() => { closeAdd(); setTagging(true); }} icon="tag">Tag</MenuItem>
                  {row.status === 'open' && cadence === 'never' && <MenuItem onClick={() => setAdder('repeat')} icon="sync">Repeat</MenuItem>}
                  {estimate == null && <MenuItem disabled={!title.trim()} onClick={() => setAdder('estimate')} icon="watch">Estimate</MenuItem>}
                </>
              )}
            </Menu>
          )}
        </>
      )}
    </div>
  );
}
