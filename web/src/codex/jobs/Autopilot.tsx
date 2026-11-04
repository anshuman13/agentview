import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAssistantStore, useAssistantTable } from '../data';
import type { AutopilotConfig, AutopilotReply, AutopilotState } from '../data/store';
import { clock } from '../time';
import { dayLabel } from '../data/dates';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Switch } from './Switch';
import { replyQueue } from '../overview/ReplyQueue';
import { openTask, setView } from '../view';

const SEEN: Record<string, string> = { held: 'Waiting for you', sent: 'Sent', dry: 'Would have sent', error: 'Failed', skipped: 'Skipped' };
const when = (t: number) => (t >= new Date().setHours(0, 0, 0, 0) ? clock(t) : dayLabel(t, true));
const day = (d: string) => dayLabel(new Date(`${d}T00:00`).getTime(), true);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function modeLine(s: AutopilotState, waiting: number) {
  const a = s.config.away;
  if (!s.config.enabled) return 'Off';
  const line = s.mode === 'away' ? `Away until ${day(a.to)}` : a.from && a.to ? `Drafts only until ${day(a.from)}` : 'Drafts only';
  const failed = s.replies.filter((r) => r.status === 'error').length;
  return [line, waiting ? `${waiting} waiting for you` : '', failed ? `${failed} failed` : '', s.config.dry_run ? 'Dry run' : ''].filter(Boolean).join(' · ');
}

function scanLine(s: AutopilotState) {
  const h = s.scan;
  const last = !h ? 'Slack scan not set up' : h.error && (h.failed ?? 0) >= (h.ok ?? 0) ? `last scan ${when(h.failed!)} failed` : h.ok ? `last scan ${when(h.ok)}${h.counts ? `, ${h.counts.messages ?? 0} messages, ${h.counts.asks ?? 0} asks` : ''}` : 'no scan yet';
  const tokens = s.cost ? s.cost.input + s.cost.output + s.cost.cache_read + s.cost.cache_write : 0;
  const cost = tokens ? ` · last scan ~${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens` : '';
  return `Checks every 15 min ${s.mode === 'away' ? 'every day until 22:00' : 'on weekdays'} · ${last}${cost}`;
}

function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      <button className="jb-auto-line jb-fold" aria-expanded={open} onClick={onToggle}><span>{title}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></button>
      {open && <div className="jb-auto-away">{children}</div>}
    </>
  );
}

// The switch for replying on my behalf in Slack: what it does and sends, dry run, then the away dates, the coverage, the people never to answer and what it saw.
export function Autopilot() {
  const store = useAssistantStore();
  const [state, setState] = useState<AutopilotState | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [fold, setFold] = useState<'away' | 'covers' | 'never' | null>(null);
  const [all, setAll] = useState(false);
  const items = useAssistantTable('items');
  const waiting = useMemo(() => replyQueue(items).length, [items]);
  // A held reply whose ask I closed or dismissed is no longer waiting on me.
  const seen = (r: AutopilotReply) => {
    const item = r.status === 'held' ? items.find((i) => i.id === r.id && i.source === 'slack') : null;
    return item && item.status !== 'suggested' && item.status !== 'open' ? (item.status === 'dismissed' ? 'Dismissed' : 'Closed') : SEEN[r.status] ?? r.status;
  };
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
  const c = state?.config;
  const toggleChannel = (name: string) => {
    if (!state) return;
    const on = state.covered.includes(name);
    void save({ channels: on ? state.covered.filter((n) => n !== name) : [...state.covered, name] });
  };
  const toggle = (f: typeof fold) => setFold(fold === f ? null : f);
  const dates = !!(c?.away.from && c.away.to);
  const awayText = dates ? `Away ${day(c!.away.from)} to ${day(c!.away.to)}${c!.away.backup ? `, ${c!.away.backup} covers` : ''}` : 'Set dates to turn on away mode';
  const openAsk = (r: AutopilotReply) => {
    const row = items.find((i) => i.id === r.id) ?? items.find((i) => !!r.url && i.source_url === r.url);
    if (row) openTask(row);
    else if (r.url) window.open(r.url, '_blank', 'noreferrer');
  };
  const replies = state ? (all ? state.replies : state.replies.slice(0, 5)) : [];
  return (
    <section className="mt-rows jb-auto" aria-label="Autopilot">
      <div className="mt-row jb-row" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(!open); } }}>
        <span className="mt-body">
          <span className="mt-title">Reply for me in Slack</span>
          <span className="wk-meta"><span>{error || (state ? modeLine(state, waiting) : 'Loading')}</span></span>
        </span>
        {c && <Switch on={c.enabled} label="Reply for me in Slack" onChange={(on) => void save({ enabled: on })} />}
      </div>
      {open && state && c && (
        <div className="jb-auto-form">
          <div className="jb-auto-how">
            <div className="muted small">How it works</div>
            {dates ? (
              <>
                <p>{`From ${day(c.away.from)} to ${day(c.away.to)} it answers simple questions itself when the thread or your wiki has the answer, and sends one holding note${c.away.backup ? `, naming ${c.away.backup}` : ''}.`}</p>
                <p>Urgent asks and people on the never-answer list always come to you.</p>
              </>
            ) : (
              <>
                <p>Each ask gets a draft. Send, Edit or Skip it from the Reply queue or the push.</p>
                <p>Nothing goes out on its own.</p>
              </>
            )}
            <Button size="sm" onClick={() => setView({ list: 'today', open: null, person: null })}>Open the Reply queue</Button>
          </div>
          <label className="jb-auto-line"><span>Dry run: logs what it would send, sends nothing. Your own Send always posts.</span><Switch on={c.dry_run} label="Dry run" onChange={(on) => void save({ dry_run: on })} /></label>
          <div className="jb-auto-line"><span>Drafts while away by</span><div className="jb-chips" role="group" aria-label="Draft model">
            {(['sonnet', 'opus'] as const).map((m) => <button key={m} className={`jb-chip${(c.model ?? 'sonnet') === m ? ' on' : ''}`} aria-pressed={(c.model ?? 'sonnet') === m} onClick={() => void save({ model: m })}>{m === 'opus' ? 'Opus' : 'Sonnet'}</button>)}
          </div></div>
          <Fold title={awayText} open={fold === 'away'} onToggle={() => toggle('away')}>
            <div className="jb-when">
              <input type="date" aria-label="Away from" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} onBlur={saveForm} />
              <span>to</span>
              <input type="date" aria-label="Away to" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} onBlur={saveForm} />
            </div>
            <input aria-label="Backup" placeholder="Who covers while you are away" value={form.backup} onChange={(e) => setForm({ ...form, backup: e.target.value })} onBlur={saveForm} />
            <input aria-label="Away note" placeholder="Extra line for the holding note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} onBlur={saveForm} />
          </Fold>
          <Fold title={`Covers ${c.dms ? 'DMs and ' : ''}${state.covered.length} of ${state.watched.length} channels`} open={fold === 'covers'} onToggle={() => toggle('covers')}>
            <div className="jb-chips" role="group" aria-label="Covers">
              <button className={`jb-chip${c.dms ? ' on' : ''}`} aria-pressed={c.dms} onClick={() => void save({ dms: !c.dms })}>DMs</button>
              {state.watched.map((n) => <button key={n} className={`jb-chip${state.covered.includes(n) ? ' on' : ''}`} aria-pressed={state.covered.includes(n)} onClick={() => toggleChannel(n)}>#{n}</button>)}
            </div>
            <div className="muted small">{scanLine(state)}</div>
          </Fold>
          <Fold title={c.escalate.length || c.manager ? `Never answers ${[...(c.manager ? [c.manager] : []), ...c.escalate].length === 1 ? (c.manager || c.escalate[0]) : `${c.escalate.length + (c.manager ? 1 : 0)} people`}` : 'Never answers: nobody yet'} open={fold === 'never'} onToggle={() => toggle('never')}>
            <input aria-label="Manager" placeholder="Your manager, name or Slack user id" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} onBlur={saveForm} />
            <input aria-label="Never answer" placeholder="Names or Slack user ids, comma separated" value={form.escalate} onChange={(e) => setForm({ ...form, escalate: e.target.value })} onBlur={saveForm} />
            <div className="muted small">Their asks always go to your phone. A name matches whole words, a user id (U...) matches exactly.</div>
          </Fold>
          {replies.length > 0 && (
            <div className="jb-auto-log">
              <div className="muted small">Seen</div>
              {replies.map((r) => (
                <button key={r.id} className="jb-run jb-seen" onClick={() => openAsk(r)}>
                  <div className="wk-meta"><span>{seen(r)}</span><span>{r.who}{r.chat ? ` · ${r.chat}` : ''}</span><span>{when(r.at)}</span></div>
                  {r.text && <div className="jb-output">{r.text}</div>}
                </button>
              ))}
              {!all && state.replies.length > 5 && <button className="btn sm" onClick={() => setAll(true)}>Show all {state.replies.length}</button>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
