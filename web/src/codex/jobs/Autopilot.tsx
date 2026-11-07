import { useEffect, useMemo, useState } from 'react';
import { useAssistantStore, useAssistantTable } from '../data';
import type { AutopilotConfig, AutopilotReply, AutopilotState } from '../data/store';
import { clock } from '../time';
import { dayLabel } from '../data/dates';
import { Button, Chip } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Switch } from './Switch';
import { replyQueue } from '../overview/ReplyQueue';
import { openTask, setView } from '../view';
import { Badge, type BadgeSpec } from '../../ui/Badge';

const SEEN: Record<string, BadgeSpec> = { held: { status: 'waiting', label: 'Needs you', reason: 'Waiting for you' }, sent: { status: 'sent' }, dry: { status: 'skipped', reason: 'Would have sent' }, error: { status: 'failed' }, skipped: { status: 'skipped' } };
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

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;
const modelName = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');

// What the hub's own Claude runs (scans, drafts, jobs) cost, by model.
function spendLine(s: AutopilotState) {
  const w = s.spend?.week;
  if (!w?.models.length) return '';
  const by = w.models.map((m) => `${modelName(m.model)} ${usd(m.usd)}`).join(', ');
  const jobs = Object.values(w.jobs ?? {}).reduce((n, v) => n + v, 0);
  return `Hub Claude use: today ${usd(s.spend!.today.usd)} · 7 days ${usd(w.usd)} (${by})${jobs > 0 ? ` · jobs ${usd(jobs)}` : ''}`;
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
  const waiting = useMemo(() => replyQueue(items, Date.now()).length, [items]);
  // A held reply whose ask I closed or dismissed is no longer waiting on me.
  const seen = (r: AutopilotReply): BadgeSpec => {
    const item = r.status === 'held' ? items.find((i) => i.id === r.id && i.source === 'slack') : null;
    return item && item.status !== 'suggested' && item.status !== 'open' ? (item.status === 'dismissed' ? { status: 'skipped', reason: 'Dismissed' } : { status: 'done', reason: 'Closed' }) : SEEN[r.status] ?? { status: 'skipped', reason: r.status };
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
  const askRow = (r: AutopilotReply) => items.find((i) => i.id === r.id) ?? items.find((i) => !!r.url && i.source_url === r.url);
  const openAsk = (r: AutopilotReply) => {
    const row = askRow(r);
    if (row) openTask(row);
    else if (r.url) window.open(r.url, '_blank', 'noreferrer');
  };
  const replies = state ? (all ? state.replies : state.replies.slice(0, 5)) : [];
  const model = c?.model ?? 'sonnet';
  const spend = state ? spendLine(state) : '';
  const flip = () => setOpen(!open);
  return (
    <section aria-label="Autopilot">
      <div className="ui-group">
        <Row plain role="button" tabIndex={0} aria-expanded={open} onClick={flip} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flip(); } }}
          title="Reply for me in Slack" meta={error || (state ? modeLine(state, waiting) : 'Loading')}
          trailing={c && <Switch on={c.enabled} label="Reply for me in Slack" onChange={(on) => void save({ enabled: on })} />} />
      </div>
      {open && state && c && (
        <div className="jb-auto-form">
          <div className="ui-group">
            <Row plain className="jb-wrap" title="How it works" trailing={<Button size="sm" onClick={() => setView({ list: 'today', open: null, person: null })}>Open the Reply queue</Button>}
              meta={dates
                ? <><span>{`From ${day(c.away.from)} to ${day(c.away.to)} it answers simple questions itself when the thread or your wiki has the answer, and sends one holding note${c.away.backup ? `, naming ${c.away.backup}` : ''}.`}</span><br /><span>Urgent asks and people on the never-answer list always come to you.</span></>
                : <><span>Each ask gets a draft. Send, Edit or Skip it from the Reply queue or the push.</span><br /><span>Nothing goes out on its own.</span></>} />
          </div>
          <div className="ui-group">
            <Row plain title="Dry run" meta="logs what it would send; your own Send always posts" trailing={<Switch on={c.dry_run} label="Dry run" onChange={(on) => void save({ dry_run: on })} />} />
          </div>
          <div className="ui-group">
            <Row plain title="Drafts while away by" trailing={
              <span role="group" aria-label="Draft model">
                {(['sonnet', 'opus'] as const).map((m) => <Chip key={m} on={model === m} aria-pressed={model === m} onClick={() => { if (model !== m) void save({ model: m }); }}>{m === 'opus' ? 'Opus' : 'Sonnet'}</Chip>)}
              </span>} />
          </div>
          <div className="ui-group">
            <Section label={awayText} open={fold === 'away'} onToggle={() => toggle('away')} />
            {fold === 'away' && (
              <div className="jb-fields">
                <div className="jb-when">
                  <input type="date" aria-label="Away from" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} onBlur={saveForm} />
                  <span>to</span>
                  <input type="date" aria-label="Away to" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} onBlur={saveForm} />
                </div>
                <input aria-label="Backup" placeholder="Who covers while you are away" value={form.backup} onChange={(e) => setForm({ ...form, backup: e.target.value })} onBlur={saveForm} />
                <input aria-label="Away note" placeholder="Extra line for the holding note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} onBlur={saveForm} />
              </div>
            )}
            <Section label={`Covers ${c.dms ? 'DMs and ' : ''}${state.covered.length} of ${state.watched.length} channels`} open={fold === 'covers'} onToggle={() => toggle('covers')} />
            {fold === 'covers' && (
              <>
                <div className="jb-fields" role="group" aria-label="Covers">
                  <Chip on={c.dms} aria-pressed={c.dms} onClick={() => void save({ dms: !c.dms })}>DMs</Chip>
                  {state.watched.map((n) => <Chip key={n} on={state.covered.includes(n)} aria-pressed={state.covered.includes(n)} onClick={() => toggleChannel(n)}>#{n}</Chip>)}
                </div>
                <Row plain className="jb-wrap" title="Slack scan" meta={scanLine(state)} />
              </>
            )}
            {spend && <Row plain className="jb-wrap" title="Spend" meta={spend} />}
            <Section label={c.escalate.length || c.manager ? `Never answers ${[...(c.manager ? [c.manager] : []), ...c.escalate].length === 1 ? (c.manager || c.escalate[0]) : `${c.escalate.length + (c.manager ? 1 : 0)} people`}` : 'Never answers: nobody yet'} open={fold === 'never'} onToggle={() => toggle('never')} />
            {fold === 'never' && (
              <>
                <div className="jb-fields">
                  <input aria-label="Manager" placeholder="Your manager, name or Slack user id" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} onBlur={saveForm} />
                  <input aria-label="Never answer" placeholder="Names or Slack user ids, comma separated" value={form.escalate} onChange={(e) => setForm({ ...form, escalate: e.target.value })} onBlur={saveForm} />
                </div>
                <Row plain className="jb-wrap" title="Who is skipped" meta="Their asks always go to your phone. A name matches whole words, a user id (U...) matches exactly." />
              </>
            )}
          </div>
          {replies.length > 0 && (
            <div>
              <Section label="Seen" count={state.replies.length} />
              <div className="ui-group">
                {replies.map((r) => {
                  const props = { title: `${r.who}${r.chat ? ` · ${r.chat}` : ''}`, lines: 2 as const, trailing: <Badge {...seen(r)} />,
                    meta: r.text ? `${when(r.at)} · ${r.text}` : when(r.at) };
                  return askRow(r) || r.url ? <Row key={r.id} {...props} onClick={() => openAsk(r)} /> : <Row key={r.id} plain {...props} />;
                })}
                {!all && state.replies.length > 5 && <div className="jb-fields"><Button variant="quiet" size="sm" onClick={() => setAll(true)}>Show all {state.replies.length}</Button></div>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
