import { useEffect, useState, type ReactNode } from 'react';
import { useAssistantStore, useAssistantTable } from '../data';
import type { AutopilotConfig, AutopilotReply, AutopilotState } from '../data/store';
import { Back } from '../../app/back';
import { Badge, type BadgeSpec } from '../../ui/Badge';
import { Button, Chip, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { useEscape, useReturnFocus } from '../../ui/util';
import { useSheetDrag } from '../../ui/useSheetDrag';
import { openTask, setView, useEscapeBack } from '../view';
import { focusRowOnReturn } from './Autopilot';
import { activityValue, awayValue, coversValue, day, modelValue, neverValue, spendLine, when } from './autopilotRows';
import { Switch } from './Switch';

const SEEN: Record<string, BadgeSpec> = { held: { status: 'waiting', label: 'Needs you', reason: 'Waiting for you' }, sent: { status: 'sent' }, dry: { status: 'skipped', reason: 'Would have sent' }, error: { status: 'failed' }, skipped: { status: 'skipped' } };

type Which = 'info' | 'away' | 'covers' | 'never' | 'model' | 'activity';

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const sheet = useSheetDrag(true, onClose);
  useEscape(sheet.close);
  return (
    <div className="as-sheet-overlay" ref={sheet.overlay} onClick={sheet.close}>
      <Back close={onClose} />
      <div className="as-sheet" ref={sheet.sheet} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" {...sheet.handle} />
        {children}
      </div>
    </div>
  );
}

// Today's replies with what was done, the first 5 until all are asked for, and what the hub's Claude cost.
function ActivitySheet({ state, onClose }: { state: AutopilotState; onClose: () => void }) {
  const items = useAssistantTable('items');
  const [all, setAll] = useState(false);
  // A held reply whose ask I closed or dismissed is no longer waiting on me.
  const seen = (r: AutopilotReply): BadgeSpec => {
    const item = r.status === 'held' ? items.find((i) => i.id === r.id && i.source === 'slack') : null;
    return item && item.status !== 'suggested' && item.status !== 'open' ? (item.status === 'dismissed' ? { status: 'skipped', reason: 'Dismissed' } : { status: 'done', reason: 'Closed' }) : SEEN[r.status] ?? { status: 'skipped', reason: r.status };
  };
  const askRow = (r: AutopilotReply) => items.find((i) => i.id === r.id) ?? items.find((i) => !!r.url && i.source_url === r.url);
  const openAsk = (r: AutopilotReply) => {
    const row = askRow(r);
    if (row) openTask(row);
    else if (r.url) window.open(r.url, '_blank', 'noreferrer');
  };
  const replies = all ? state.replies : state.replies.slice(0, 5);
  const spend = spendLine(state);
  return (
    <Sheet label="Activity" onClose={onClose}>
      {replies.length > 0 && (
        <>
          <Section label="Seen" count={state.replies.length} />
          <div className="as-group">
            {replies.map((r) => {
              const props = { title: `${r.who}${r.chat ? ` · ${r.chat}` : ''}`, lines: 2 as const, trailing: <Badge {...seen(r)} />, meta: r.text ? `${when(r.at)} · ${r.text}` : when(r.at) };
              return askRow(r) || r.url ? <Row key={r.id} {...props} onClick={() => openAsk(r)} /> : <Row key={r.id} plain {...props} />;
            })}
            {!all && state.replies.length > 5 && <div className="jb-fields"><Button variant="quiet" size="sm" onClick={() => setAll(true)}>Show all {state.replies.length}</Button></div>}
          </div>
        </>
      )}
      {spend && <Row plain className="jb-wrap" title="Spend" meta={spend} />}
    </Sheet>
  );
}

export function SettingRows({ state, onOpen, onDryRun }: { state: AutopilotState; onOpen: (which: Which) => void; onDryRun: (on: boolean) => void }) {
  const setting = (which: Which, title: string, meta: string) => <Row title={title} meta={meta} trailing={<Icon name="chevron-right" small />} onClick={() => onOpen(which)} />;
  return (
    <div className="ui-group">
      {setting('away', 'Away', awayValue(state))}
      {setting('covers', 'Covers', coversValue(state))}
      {setting('never', 'Never answers', neverValue(state))}
      {setting('model', 'Model', modelValue(state))}
      <Row plain title="Dry run" trailing={<Switch on={state.config.dry_run} label="Dry run" onChange={onDryRun} />} />
      {setting('activity', 'Activity', activityValue(state))}
    </div>
  );
}

// The settings of replying on my behalf in Slack: one row per setting, each opening a sheet with just its fields.
export function AutopilotPage() {
  const store = useAssistantStore();
  const [state, setState] = useState<AutopilotState | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<Which | null>(null);
  const [form, setForm] = useState({ from: '', to: '', backup: '', note: '', escalate: '', manager: '' });
  const load = (p: Promise<AutopilotState>) => p.then((s) => { setState(s); setForm({ ...s.config.away, escalate: s.config.escalate.join(', '), manager: s.config.manager ?? '' }); setError(''); }).catch((err) => setError((err as Error).message));
  useEffect(() => void load(store.autopilot()), [store]);
  const save = (patch: Partial<AutopilotConfig>) => load(store.autopilot(patch));
  const saveForm = () => {
    const { escalate, manager, ...a } = form;
    const c = state?.config;
    if (!c || (JSON.stringify(a) === JSON.stringify(c.away) && escalate === c.escalate.join(', ') && manager === (c.manager ?? ''))) return;
    void save({ away: a, escalate: escalate.split(',').map((x) => x.trim()).filter(Boolean), manager });
  };
  const close = () => { saveForm(); setSheet(null); };
  const back = () => { focusRowOnReturn(); setView({ open: null }); };
  useEscapeBack(sheet ? () => {} : back);
  useReturnFocus(!!sheet);
  const c = state?.config;
  const toggleChannel = (name: string) => {
    if (!state) return;
    const on = state.covered.includes(name);
    void save({ channels: on ? state.covered.filter((n) => n !== name) : [...state.covered, name] });
  };
  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <input aria-label={label} placeholder={placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} onBlur={saveForm} />
  );
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to jobs" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <h1>Reply for me in Slack</h1>
        <span className="spacer" />
        <IconButton icon="info" label="How it works" onClick={() => setSheet('info')} />
      </header>
      <div className="wk-scroll">
        <div className="mt-page">
          {error && <div className="ui-group"><Row plain title="Could not load or save" meta={error} /></div>}
          {state && <SettingRows state={state} onOpen={setSheet} onDryRun={(on) => void save({ dry_run: on })} />}
        </div>
      </div>
      {state && c && sheet === 'info' && (
        <Sheet label="How it works" onClose={close}>
          <Row plain className="jb-wrap" title="How it works"
            meta={c.away.from && c.away.to
              ? <><span>{`From ${day(c.away.from)} to ${day(c.away.to)} it answers simple questions itself when the thread or your wiki has the answer, and sends one holding note${c.away.backup ? `, naming ${c.away.backup}` : ''}.`}</span><br /><span>Urgent asks and people on the never-answer list always come to you.</span></>
              : <><span>Each ask gets a draft. Send, Edit or Skip it from the Reply queue or the push.</span><br /><span>Nothing goes out on its own.</span></>} />
          <div className="jb-fields"><Button onClick={() => setView({ list: 'today', open: null, person: null })}>Open the Reply queue</Button></div>
        </Sheet>
      )}
      {state && c && sheet === 'away' && (
        <Sheet label="Away" onClose={close}>
          <Section label="Away" />
          <div className="jb-fields">
            <div className="jb-when">
              <input type="date" aria-label="Away from" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} onBlur={saveForm} />
              <span>to</span>
              <input type="date" aria-label="Away to" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} onBlur={saveForm} />
            </div>
            {field('backup', 'Backup', 'Who covers while you are away')}
            {field('note', 'Away note', 'Extra line for the holding note')}
          </div>
        </Sheet>
      )}
      {state && c && sheet === 'covers' && (
        <Sheet label="Covers" onClose={close}>
          <Section label="Covers" />
          <div className="jb-fields" role="group" aria-label="Covers">
            <Chip on={c.dms} aria-pressed={c.dms} onClick={() => void save({ dms: !c.dms })}>DMs</Chip>
            {state.watched.map((n) => <Chip key={n} on={state.covered.includes(n)} aria-pressed={state.covered.includes(n)} onClick={() => toggleChannel(n)}>#{n}</Chip>)}
          </div>
        </Sheet>
      )}
      {state && c && sheet === 'never' && (
        <Sheet label="Never answers" onClose={close}>
          <Section label="Never answers" />
          <div className="jb-fields">
            {field('manager', 'Manager', 'Your manager, name or Slack user id')}
            {field('escalate', 'Never answer', 'Names or Slack user ids, comma separated')}
          </div>
        </Sheet>
      )}
      {state && c && sheet === 'model' && (
        <Sheet label="Model" onClose={close}>
          <Section label="Model" />
          <div className="jb-fields" role="group" aria-label="Draft model">
            {(['sonnet', 'opus'] as const).map((m) => <Chip key={m} on={c.model === m} aria-pressed={c.model === m} onClick={() => { if (c.model !== m) void save({ model: m }); }}>{m === 'opus' ? 'Opus' : 'Sonnet'}</Chip>)}
          </div>
        </Sheet>
      )}
      {state && sheet === 'activity' && <ActivitySheet state={state} onClose={close} />}
    </div>
  );
}
