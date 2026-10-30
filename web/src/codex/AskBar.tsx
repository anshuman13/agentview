import { useEffect, useRef, useState } from 'react';
import { useAssistantStore, useCodex } from './data';
import type { Meeting } from './data/wiki';
import { ask, askText } from './data/ask';
import { SNOOZES, isQuestion, parseWhen, stripWhen } from './data/engine';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { touch } from '../app/touch';
import { Voice, useDictation } from '../chat/Voice';
import { readFlag, saveFlag } from '../ui/util';
import { FILTER_LABEL, showSnack, type Filter } from './view';
import { PickTime, clock, when } from './time';

type Mode = 'task' | 'ask';

const QUICK = ['In 1 hour', 'Tonight', 'Tomorrow'];
export const snoozes = (now = new Date()) => SNOOZES.filter((s) => s.label !== 'Tonight' || now.getHours() < 19);

const marked = (text: string, spans: [number, number][]) => {
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const [s, e] of spans) {
    if (s < i) continue;
    out.push(text.slice(i, s), <mark key={s}>{text.slice(s, e)}</mark>);
    i = e;
  }
  out.push(text.slice(i));
  return out;
};

type Chip = { label: string; q: string };

const recipes = (next: Meeting | undefined): Chip[] => {
  const now = new Date();
  const h = now.getHours();
  const list: Chip[] = [
    h < 12 ? { label: 'Plan my day', q: 'Plan my day. Use my calendar for today and my open items, suggest an order with times and point out conflicts.' }
      : h < 17 ? { label: "What's next", q: 'What should I do next? Use my calendar and my open items.' }
      : { label: 'Wrap up my day', q: 'Wrap up my day: what got done, what is still open, suggested meeting actions I have not confirmed, and my first meeting tomorrow.' },
  ];
  if (now.getDay() === 4 || now.getDay() === 5) list.push({ label: 'Draft my weekly update', q: 'Draft my weekly update from what I got done this week and the meetings I was in: done, in progress, next. Short bullets.' });
  if (next) list.unshift({ label: 'Prep next meeting', q: prepText(next) });
  return list;
};

export const prepText = (m: Meeting) => `Prepare me for "${m.title}" at ${clock(m.starts_at!)}: who is in it, related Slack threads, Linear issues and docs, and what is still open from the last time we met.`;

export function Composer({ items, next, filter }: { items: ItemRow[]; next?: Meeting; filter: Filter }) {
  const store = useAssistantStore();
  const { meetings } = useCodex();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [noWhen, setNoWhen] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  const [voice, setVoice] = useState(0);
  const [asking, setAsking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dictate = useDictation(text, setText);

  useEffect(() => {
    const focus = () => area.current?.focus();
    const talk = () => setVoice(Date.now());
    window.addEventListener('assistant:focus', focus);
    window.addEventListener('assistant:voice', talk);
    return () => { window.removeEventListener('assistant:focus', focus); window.removeEventListener('assistant:voice', talk); };
  }, []);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const typed = text.trim();
  const m: Mode = mode ?? (isQuestion(typed) ? 'ask' : 'task');
  const prof: Profile = profile ?? (filter !== 'all' ? filter : readFlag('assistant-personal', false) ? 'personal' : 'work');
  const w = m === 'task' && !noWhen ? parseWhen(text) : null;
  const due = m === 'task' ? pick ?? w?.at ?? null : null;
  const dated = pick != null || w != null;

  const reset = () => { setText(''); setMode(null); setNoWhen(false); setPick(null); setFresh(false); setProfile(null); setAsking(false); };
  const busy = useRef(false);
  const save = async (title: string, at: number | null) => {
    const row = await store.capture(title, 'task', prof, at);
    saveFlag('assistant-personal', prof === 'personal');
    reset();
    showSnack(at != null ? `Task · ${when(at)}` : 'Task · No time', () => void store.update(row, { deleted: 1 }));
  };
  // With no time in the text, the chips ask When? before the task is saved.
  const submit = async (at = due) => {
    if (!typed || busy.current) return;
    if (m === 'ask') {
      if (ask(askText(typed, items, undefined, meetings), fresh)) reset();
      return;
    }
    if (at == null && !noWhen && !asking) return setAsking(true);
    busy.current = true;
    try {
      await save(stripWhen(text, w) || typed, at);
    } catch (err) {
      showSnack(`Not saved: ${(err as Error).message}`);
    } finally {
      busy.current = false;
    }
  };
  const cycle = () => setMode((x) => ((x ?? m) === 'task' ? 'ask' : 'task'));
  const MODE: Record<Mode, { icon: string; label: string }> = { task: { icon: 'pass', label: 'Task' }, ask: { icon: 'sparkle', label: 'Ask Claude' } };

  return (
    <div className="as-composer">
      <div className="as-chips" onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button') && document.activeElement === area.current) e.preventDefault(); }}>
        {typed ? (
          <>
            <button className="as-chip on" title="A task or a question for Claude" onClick={cycle}><Icon name={MODE[m].icon} small /> {MODE[m].label}</button>
            {m === 'ask' && <button className={`as-chip${fresh ? ' on' : ''}`} title="Ask in today's Codex chat or start a new one" onClick={() => setFresh((f) => !f)}><Icon name={fresh ? 'add' : 'comment-discussion'} small /> {fresh ? 'New chat' : "Today's chat"}</button>}
            {m !== 'ask' && <button className={`as-chip ${prof}`} title="Work or personal" onClick={() => setProfile(prof === 'work' ? 'personal' : 'work')}>{FILTER_LABEL[prof]}</button>}
            {m === 'task' && asking && !dated ? (
              <>
                <span className="as-ask">When?</span>
                {snoozes().filter((s) => QUICK.includes(s.label)).map((s) => <button key={s.label} className="as-chip time" onClick={() => void submit(s.at(new Date()))}><Icon name="clock" small /> {s.label}</button>)}
                <button className="as-chip" onClick={() => void submit(null)}>No time</button>
                <PickTime className="as-chip time" onPick={(t) => void submit(t)} />
              </>
            ) : m === 'task' && (dated ? (
              <button className="as-chip when on" title="Remove the time" onClick={() => { setPick(null); setNoWhen(true); }}><Icon name="clock" small /> {due != null ? when(due) : 'Today'} <Icon name="close" small /></button>
            ) : (
              <>
                {snoozes().filter((s) => QUICK.includes(s.label)).map((s) => <button key={s.label} className="as-chip time" onClick={() => setPick(s.at(new Date()))}><Icon name="clock" small /> {s.label}</button>)}
                <PickTime className="as-chip time" onPick={setPick} />
              </>
            ))}
          </>
        ) : (
          recipes(next).map((r) => <button key={r.label} className="as-chip" onClick={() => ask(askText(r.q, items, undefined, meetings))}><Icon name="sparkle" small /> {r.label}</button>)
        )}
      </div>
      <div className="cp-card as-card">
        <div className="as-input">
          {w && pick == null && <div className="as-mirror" aria-hidden>{marked(text, w.spans)}</div>}
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder="Add a task or ask anything"
            onChange={(e) => { setText(e.target.value); if (!e.target.value.trim()) { setAsking(false); setNoWhen(false); setPick(null); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (!touch() || e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          />
        </div>
        <div className="cp-foot">
          <span className="cp-spacer" />
          <Voice onText={dictate} autoStart={voice} />
          <button className="cp-send" onPointerDown={(e) => e.preventDefault()} title={m === 'ask' ? (fresh ? 'Ask Claude in a new chat' : "Ask Claude in today's Codex chat") : 'Save'} aria-label="Send" disabled={!typed} onClick={() => void submit()}>
            <Icon name="arrow-up" />
          </button>
        </div>
      </div>
    </div>
  );
}
