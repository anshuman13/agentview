import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from '../data';
import { ask, meetingAskText } from '../data/ask';
import { followUpText, hasContent, toMarkdown } from '../data/meetingMarkdown';
import { parseWhen, stripWhen } from '../data/engine';
import { SUMMARY_TEMPLATES, rememberTemplate, summaryInstructions, templateFor, type SummaryTemplate } from '../data/summaryTemplates';
import type { ItemRow } from '../data/sync';
import { TRANSCRIPT_TRIES as TRIES, actionCount, actionsOf, listOf, meetingState, othersOf, peopleOf, pinsOf, seriesOf, seriesRepeats, type Meeting } from '../data/wiki';
import { clock, when } from '../time';
import { dayLabel } from '../data/dates';
import { errorText } from '../data/engine';
import { Icon } from '../../ui/Icon';
import { safeHref } from '../../ui/util';
import { Voice, useDictation } from '../../chat/Voice';
import { copyText, meetingKey, openMeeting, setView, showSnack, useEscapeBack } from '../view';
import { AskBar } from '../wiki/Wiki';
import { ActionRow, confirmAll } from './ActionRow';
import { Avatars } from './MeetingList';
import { PinList, PinnableSummary } from './Pins';
import { Prep } from './Prep';
import { useSnackTask } from './useSnackTask';

function Series({ m, prior }: { m: Meeting; prior: Meeting[] }) {
  const snap = useAssistantData();
  if (!prior.length) return null;
  const repeats = seriesRepeats(m, prior[0]);
  const date = (x: Meeting) => dayLabel(x.starts_at!);
  const open = openMeeting;
  const decisions = prior.slice(0, 3).flatMap((x) => listOf(x.decisions).map((t) => t.trim()).filter(Boolean).map((text) => ({ x, text })));
  const undone = prior.flatMap((x) => actionsOf(snap.items, x).filter((r) => r.status === 'open').map((r) => ({ x, r })));
  return (
    <section className="mt-sec">
      <h2>Series</h2>
      <p className="mt-series">{prior.length} earlier, last on {date(prior[0])}</p>
      {repeats.decisions.length + repeats.questions.length > 0 && <div className="mt-series-list">
        {repeats.decisions.map((text, i) => <button key={`d${i}`} className="mt-log-item" onClick={() => open(prior[0])}><span className="mt-log-text">{text}</span><span className="mt-log-from">Decided again, also on {date(prior[0])}</span></button>)}
        {repeats.questions.map((text, i) => <button key={`q${i}`} className="mt-log-item" onClick={() => open(prior[0])}><span className="mt-log-text">{text}</span><span className="mt-log-from">Asked again, also on {date(prior[0])}</span></button>)}
      </div>}
      {decisions.length > 0 && <div className="mt-series-list">{decisions.map(({ x, text }, i) => (
        <button key={i} className="mt-log-item" onClick={() => open(x)}><span className="mt-log-text">{text}</span><span className="mt-log-from">Decided {date(x)}</span></button>
      ))}</div>}
      {undone.length > 0 && <div className="mt-series-list">{undone.map(({ x, r }) => (
        <button key={r.profile + r.id} className="mt-log-item" onClick={() => open(x)}><span className="mt-log-text">{r.title || r.text}</span><span className="mt-log-from">Still open from {date(x)}</span></button>
      ))}</div>}
    </section>
  );
}

const ORDER: Record<string, number> = { open: 0, done: 1 };

function Fold({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className="mt-sec mt-fold">
      <button className="mt-fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{title} · {count} <Icon name={open ? 'chevron-up' : 'chevron-down'} small /></button>
      {open && children}
    </section>
  );
}

function AddAction({ m }: { m: Meeting }) {
  const store = useAssistantStore();
  const [text, setText] = useState('');
  const dictate = useDictation(text, setText);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const w = parseWhen(t);
    void store.capture(stripWhen(t, w) || t, 'task', m.profile, w?.at ?? null, { id: m.id, title: m.title });
    setText('');
  };
  return (
    <form className="mt-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <Icon name="add" small />
      <input value={text} placeholder="Add an action, like “send the slides friday”" aria-label="Add an action" onChange={(e) => setText(e.target.value)} />
      <Voice onText={dictate} />
    </form>
  );
}

const SAVE_AFTER = 800;

// Saves while you type, and before the page hides or the meeting closes; takes synced notes while the field is not focused.
function Notes({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [text, setText] = useState(m.notes ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  const row = useRef(m);
  row.current = m;
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const t = pending.current;
    pending.current = null;
    if (t !== null && t !== (row.current.notes ?? '')) void store.editRow('meetings', row.current, { notes: t });
  }, [store]);
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);
  useEffect(() => {
    if (pending.current === null && document.activeElement !== area.current) setText(m.notes ?? '');
  }, [m.notes]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const change = (value: string) => {
    setText(value);
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER);
  };
  return (
    <textarea ref={area} className="mt-notes" value={text} rows={2} placeholder="Write your notes. They stay yours; the summary is written separately."
      onChange={(e) => change(e.target.value)} onBlur={() => { const typed = pending.current !== null; flush(); if (!typed) setText(row.current.notes ?? ''); }} />
  );
}

function SummaryFormat({ m, series }: { m: Meeting; series: Meeting[] }) {
  const { store } = useCodex();
  const [busy, run] = useSnackTask();
  if (!m.id.startsWith('cal:') || !m.starts_at || m.starts_at > Date.now()) return null;
  const choose = (key: SummaryTemplate) => run(async () => {
    await store.fetchTranscript(m, summaryInstructions(key));
    rememberTemplate(m, key);
    showSnack(`Summary rewritten as ${SUMMARY_TEMPLATES[key].label}`);
  }, 'Summary failed');
  const suggested = templateFor(m, series);
  return (
    <select className="mt-sync" value="" disabled={busy} aria-label="Summary format" title="Summary format" onChange={(e) => void choose(e.target.value as SummaryTemplate)}>
      <option value="" disabled>{busy ? 'Rewriting' : 'Summary format'}</option>
      {(Object.keys(SUMMARY_TEMPLATES) as SummaryTemplate[]).map((k) => <option key={k} value={k}>{SUMMARY_TEMPLATES[k].label}{k === suggested ? ' (suggested)' : ''}</option>)}
    </select>
  );
}

function TranscriptButton({ m, label }: { m: Meeting; label: string }) {
  const { store } = useCodex();
  const [busy, run] = useSnackTask();
  if (!m.id.startsWith('cal:') || !m.starts_at || m.starts_at > Date.now()) return null;
  const read = () => run(async () => {
    showSnack((await store.fetchTranscript(m)) ? 'Read the transcript' : 'No transcript found yet');
  }, 'Transcript sync failed');
  return (
    <button className="btn sm mt-sync" disabled={busy} title="Read the transcript: summary and actions" onClick={read}>
      <Icon name={busy ? 'loading' : 'sync'} small spin={busy} /> {busy ? 'Reading' : label}
    </button>
  );
}

// One line on where the meeting is, so an empty action list always has a reason.
function StateLine({ m, now }: { m: Meeting; now: number }) {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const c = actionCount(snap.items, m);
  const others = othersOf(m).length;
  const state = meetingState(m, now);
  const parts: string[] = [];
  if (state === 'upcoming') parts.push(`Starts ${when(m.starts_at!, now)}`);
  if (state === 'live') parts.push('In progress');
  if (state === 'waiting') parts.push(m.tries ? `Waiting for the transcript · try ${m.tries} of ${TRIES}` : 'Waiting for the transcript');
  if (state === 'missing') parts.push('No Gemini notes found for this meeting');
  if (state === 'done') {
    parts.push(c.total ? `${c.total} for you` : 'Nothing for you');
    if (c.review) parts.push(`${c.review} to review`);
    if (others) parts.push(`${others} others took`);
    if (c.unassigned) parts.push(`${c.unassigned} unassigned`);
  }
  if (!parts.length) return null;
  return (
    <div className={`mt-state ${state}`}>
      <span>{parts.join(' · ')}</span>
      {(state === 'waiting' || state === 'missing') && <TranscriptButton m={m} label={state === 'missing' ? 'Retry' : 'Read now'} />}
      {state === 'missing' && <button className="btn sm" title="Nothing to add for this meeting" onClick={() => void store.editRow('meetings', m, { transcript: 'done' })}>Dismiss</button>}
    </div>
  );
}

// The room microphone speaks for whoever sits in the room; asked once per meeting, a yes reads the transcript again with
// that speaker as me.
function RoomMic({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [busy, setBusy] = useState(false);
  if (!m.room || m.room_me != null) return null;
  const yes = async () => {
    setBusy(true);
    await store.editRow('meetings', m, { room_me: 1 });
    await store.syncNow();
    try {
      const { error } = store.snapshot().sync;
      if (error) throw new Error(`the room mic answer did not sync: ${error}`);
      await store.fetchTranscript(m);
      showSnack('Read again with the room mic as you');
    } catch (err) {
      showSnack(`Transcript sync failed: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-room">
      <Icon name="mic" />
      <span>Were you on the room mic, <b>{m.room}</b>?</span>
      <button className="btn sm" disabled={busy} onClick={() => void store.editRow('meetings', m, { room_me: 0 })}>No</button>
      <button className="btn sm primary" disabled={busy} onClick={yes}>{busy ? 'Reading' : 'Yes, me'}</button>
    </div>
  );
}

function CopyButtons({ m, actions }: { m: Meeting; actions: ItemRow[] }) {
  if (!hasContent(m, actions)) return null;
  return (
    <>
      <button className="icon-btn" title="Copy as Markdown" aria-label="Copy as Markdown" onClick={() => copyText(toMarkdown(m, actions))}><Icon name="copy" /></button>
      <button className="icon-btn" title="Copy a follow-up draft" aria-label="Copy a follow-up draft" onClick={() => copyText(followUpText(m, actions), 'Follow-up copied')}><Icon name="mail" /></button>
    </>
  );
}

export function MeetingPage({ m }: { m: Meeting }) {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const prior = useMemo(() => seriesOf(meetings, m), [meetings, m]);
  const all = actionsOf(snap.items, m);
  const by = (st: string) => all.filter((r) => r.status === st);
  const mine = all.filter((r) => r.status === 'open' || r.status === 'done').sort((a, b) => (ORDER[a.status ?? ''] ?? 2) - (ORDER[b.status ?? ''] ?? 2) || a.updated_at - b.updated_at);
  const review = by('suggested');
  const pins = pinsOf(all, [m]);
  const count = actionCount(snap.items, m);
  const others = othersOf(m);
  const decisions = listOf(m.decisions);
  const people = peopleOf(m);
  const now = Date.now();
  const state = meetingState(m, now);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const day = m.starts_at ? new Date(m.starts_at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to meetings" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Meetings</button></nav>
        <span className="spacer" />
        <CopyButtons m={m} actions={all} />
        {state === 'done' && <TranscriptButton m={m} label="Read again" />}
        {m.calendar_url && <a className="btn sm" href={safeHref(m.calendar_url)} target="_blank" rel="noreferrer"><Icon name="calendar" small /> Calendar</a>}
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <h1 className="wk-title">{m.title}</h1>
          <div className="wk-meta mt-when">
            <span>{day}</span>
            {m.starts_at && <span>{clock(m.starts_at)}{m.ends_at ? `–${clock(m.ends_at)}` : ''}</span>}
            {m.recorded_ms ? <span><Icon name="record" small /> Recorded {Math.round(m.recorded_ms / 60000)} min</span> : null}
          </div>
          {people.length > 0 && <div className="mt-people"><Avatars people={people} max={5} /><span>{people.slice(0, 3).map((p, i) => <span key={p}>{i > 0 && ', '}<button className="mt-person" onClick={() => setView({ person: p })}>{p}</button></span>)}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</span></div>}
          <StateLine m={m} now={now} />
          <RoomMic m={m} />

          <section className="mt-sec">
            <h2>My actions{count.total > 0 && <span className="mt-of">{count.done} of {count.total} done</span>}</h2>
            {mine.length > 0 && <div className="mt-tasks">{mine.map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>}
            {!mine.length && !review.length && (
              <p className="mt-pending">{state === 'missing' ? 'No transcript. Add actions below.' : state === 'done' ? 'Nothing for you in the transcript.' : 'Your actions from the transcript land here and in Today.'}</p>
            )}
            <AddAction m={m} />
          </section>

          {review.length > 0 && (
            <section className="mt-sec">
              <h2>To review<span className="mt-of">{review.length}</span>{review.length > 1 && <button className="btn sm mt-sync" onClick={() => confirmAll(store, review)}><Icon name="check-all" small /> Confirm all</button>}</h2>
              <div className="mt-tasks">{review.map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>
            </section>
          )}

          <section className="mt-sec">
            <h2><Icon name="sparkle" small /> Summary{m.summary && <SummaryFormat m={m} series={prior} />}</h2>
            {m.summary ? <PinnableSummary m={m} /> : <p className="mt-pending">{state === 'missing' ? 'No summary without a transcript.' : 'Written from the transcript after the meeting.'}</p>}
          </section>

          {pins.length > 0 && (
            <section className="mt-sec">
              <h2>Pinned<span className="mt-of">{pins.length}</span></h2>
              <PinList pins={pins} />
            </section>
          )}

          {decisions.length > 0 && (
            <section className="mt-sec">
              <h2>Decisions</h2>
              <ul className="mt-decisions">{decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}

          {state === 'upcoming' && <Prep m={m} section />}

          <Series m={m} prior={prior} />

          <section className="mt-sec">
            <h2>My notes</h2>
            <Notes key={meetingKey(m)} m={m} />
          </section>

          <Fold title="Unassigned" count={count.unassigned}>
            <div className="mt-tasks">{by('unassigned').map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>
          </Fold>
          <Fold title="Others took" count={others.length}>
            <ul className="mt-others">{others.map((o, i) => <li key={i}><b>{o.who}</b> {o.what}</li>)}</ul>
          </Fold>
          <Fold title="Not mine" count={count.dismissed}>
            <div className="mt-tasks">{by('dismissed').map((r) => <ActionRow key={r.profile + r.id} row={r} meeting={m} />)}</div>
          </Fold>
        </article>
      </div>
      <AskBar placeholder="Ask about this meeting" onAsk={(q) => ask(meetingAskText(q, m, all))} />
    </div>
  );
}
