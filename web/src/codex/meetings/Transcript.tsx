import { useEffect, useMemo, useState } from 'react';
import { useAssistantStore } from '../data';
import { errorText } from '../data/engine';
import { SUMMARY_TEMPLATES, rememberTemplate, summaryInstructions, templateFor, type SummaryTemplate } from '../data/summaryTemplates';
import { talkTime } from '../data/talkTime';
import type { Meeting } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { plural } from '../../ui/util';
import { showSnack } from '../view';
import { rowKey } from '../data/sync';
import { useSnackTask } from './useSnackTask';

// The transcript text stays on the hub; a summarized meeting fetches it for the talk time and the Transcript section, again after each new summary.
export function useTranscript(m: Meeting, on: boolean) {
  const store = useAssistantStore();
  const [got, setGot] = useState<{ key: string; text: string | null; error?: string }>();
  const key = rowKey(m);
  useEffect(() => {
    if (!on) return;
    let live = true;
    store.transcript(m).then((text) => live && setGot({ key, text }), (err) => live && setGot({ key, text: null, error: errorText(err) }));
    return () => {
      live = false;
    };
  }, [key, on, m.summary, store]);
  return got?.key === key ? got : undefined;
}

const TOP = 5;

export function TalkTime({ text, actions, decisions }: { text: string; actions: number; decisions: number }) {
  const speakers = useMemo(() => talkTime(text), [text]);
  if (!speakers.length) return null;
  const top = speakers.slice(0, TOP);
  const rest = speakers.slice(TOP).reduce((a, s) => a + s.share, 0);
  const parts = rest > 0 ? [...top, { name: 'Others', share: rest }] : top;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <section className="mt-sec">
      <h2>Talk time<span className="mt-of">{plural(actions, 'action')} · {plural(decisions, 'decision')}</span></h2>
      <div className="mt-talk" role="img" aria-label={parts.map((p) => `${p.name} ${pct(p.share)}`).join(', ')}>
        {parts.map((p, i) => <span key={p.name} className={`mt-talk-${i}`} style={{ width: pct(p.share) }} title={`${p.name} ${pct(p.share)}`} />)}
      </div>
      <div className="mt-talk-keys">
        {parts.map((p, i) => <span key={p.name}><i className={`mt-talk-${i}`} />{p.name} {pct(p.share)}</span>)}
      </div>
    </section>
  );
}

export function Transcript({ got }: { got: { text: string | null; error?: string } | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-sec mt-fold">
      <button className="mt-fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Transcript <Icon name={open ? 'chevron-up' : 'chevron-down'} small /></button>
      {open && (!got ? <p className="mt-pending">Loading</p> : got.error ? <p className="mt-pending">Could not load the transcript: {got.error}</p> : got.text ? <pre className="mt-transcript">{got.text}</pre> : <p className="mt-pending">No transcript text kept for this meeting.</p>)}
    </section>
  );
}

// A calendar meeting that has started has a transcript to read.
const readable = (m: Meeting) => m.id.startsWith('cal:') && !!m.starts_at && m.starts_at <= Date.now();

export function SummaryFormat({ m, series }: { m: Meeting; series: Meeting[] }) {
  const store = useAssistantStore();
  const [busy, run] = useSnackTask();
  if (!readable(m)) return null;
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

export function TranscriptButton({ m, label }: { m: Meeting; label: string }) {
  const store = useAssistantStore();
  const [busy, run] = useSnackTask();
  if (!readable(m)) return null;
  const read = () => run(async () => {
    showSnack((await store.fetchTranscript(m)) ? 'Read the transcript' : 'No transcript found yet');
  }, 'Transcript sync failed');
  return (
    <button className="btn sm mt-sync" disabled={busy} title="Read the transcript: summary and actions" onClick={read}>
      <Icon name={busy ? 'loading' : 'sync'} small spin={busy} /> {busy ? 'Reading' : label}
    </button>
  );
}

// The room microphone speaks for whoever sits in the room; asked once per meeting, a yes reads the transcript again with
// that speaker as me.
export function RoomMic({ m }: { m: Meeting }) {
  const store = useAssistantStore();
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
