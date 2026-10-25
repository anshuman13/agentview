import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant } from '../assistant';
import { atTime, split } from '../assistant/engine';
import type { ItemRow, Profile } from '../assistant/sync';
import { Icon } from '../Icon';
import { Voice, useDictation } from './Voice';
import { ago, pressable, readFlag, saveFlag } from './util';
import '../styles/features/assistant.css';

type Tab = 'today' | 'capture' | 'notes';
type Filter = 'all' | Profile;

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'capture', label: 'Capture' },
  { id: 'notes', label: 'Notes' },
];
const SWIPE = 80;

const tag = (p: Profile) => (p === 'work' ? 'Work' : 'Personal');

function Swipe({ onDone, onSnooze, children }: { onDone: () => void; onSnooze: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? ' left' : ''}`}>
      <div className="as-swipe-bg"><span><Icon name="check" /> Done</span><span>Snooze <Icon name="clock" /></span></div>
      <div
        className="as-swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: moving.current ? 'none' : undefined }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') from.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => {
          if (!from.current) return;
          const mx = e.clientX - from.current.x;
          if (!moving.current) {
            if (Math.abs(e.clientY - from.current.y) > 10 && Math.abs(e.clientY - from.current.y) > Math.abs(mx)) { from.current = null; return; }
            if (Math.abs(mx) < 10) return;
            moving.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(mx);
        }}
        onPointerUp={() => {
          if (moving.current && dx > SWIPE) onDone();
          else if (moving.current && dx < -SWIPE) onSnooze();
          reset();
        }}
        onPointerCancel={reset}
      >
        {children}
      </div>
    </div>
  );
}

function Task({ row, onDone, onSnooze }: { row: ItemRow; onDone: () => void; onSnooze: () => void }) {
  const at = atTime(row.at);
  const later = at != null && at > Date.now();
  return (
    <Swipe onDone={onDone} onSnooze={onSnooze}>
      <div className="as-task">
        <div className="as-body">
          <div className="as-title">{row.title || '(Untitled)'}</div>
          <div className="as-meta">
            <span className={`chip sm outline as-tag ${row.profile}`}>{tag(row.profile)}</span>
            {row.source && row.source !== 'capture' && <span>{row.source}</span>}
            {later && <span>until {new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
        <button className="icon-btn" title="Snooze until tomorrow" aria-label="Snooze" onClick={onSnooze}><Icon name="clock" /></button>
        <button className="icon-btn as-done" title="Done" aria-label="Done" onClick={onDone}><Icon name="check" /></button>
      </div>
    </Swipe>
  );
}

function Capture({ onSave }: { onSave: (text: string, type: 'task' | 'note', profile: Profile) => Promise<void> }) {
  const [text, setText] = useState('');
  const [type, setType] = useState<'task' | 'note'>('task');
  const [profile, setProfile] = useState<Profile>(() => (readFlag('assistant-personal', false) ? 'personal' : 'work'));
  const [msg, setMsg] = useState('');
  const dictate = useDictation(text, setText);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);

  const save = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await onSave(value, type, profile);
      setText('');
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(`Not saved: ${(err as Error).message}`);
    }
  };
  const pick = (p: Profile) => { setProfile(p); saveFlag('assistant-personal', p === 'personal'); };

  return (
    <div className="as-capture">
      <textarea
        ref={area}
        value={text}
        placeholder="What's on your mind?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }}
      />
      <div className="as-capture-bar">
        <div className="as-seg">
          <button className={type === 'task' ? 'active' : ''} onClick={() => setType('task')}>Task</button>
          <button className={type === 'note' ? 'active' : ''} onClick={() => setType('note')}>Note</button>
        </div>
        <div className="as-seg">
          <button className={profile === 'work' ? 'active' : ''} onClick={() => pick('work')}>Work</button>
          <button className={profile === 'personal' ? 'active' : ''} onClick={() => pick('personal')}>Personal</button>
        </div>
        <Voice onText={dictate} />
      </div>
      <button className="btn primary lg" disabled={!text.trim()} onClick={save}>Save</button>
      <div className="muted small as-msg">{msg}</div>
    </div>
  );
}

export function Assistant() {
  const { store, snap } = useAssistant();
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [filter, setFilter] = useState<Filter>('all');
  const [minute, tick] = useState(0);

  useEffect(() => {
    const shown = () => document.visibilityState === 'visible' && root.current?.offsetParent != null;
    const retry = () => { if (shown()) store.unlock(); };
    retry();
    document.addEventListener('visibilitychange', retry);
    const t = setInterval(() => tick((n) => n + 1), 60000);
    return () => { document.removeEventListener('visibilitychange', retry); clearInterval(t); };
  }, [store]);

  const { today, later, notes } = useMemo(() => split(snap.items, filter, Date.now()), [snap.items, filter, minute]);
  const { sync } = snap;

  if (snap.phase !== 'ready') {
    return (
      <div className="assistant locked" ref={root}>
        <Icon name="lock" />
        <div className="as-lock-title">Assistant</div>
        <div className="muted">{snap.message}</div>
        {snap.phase === 'locked' && <button className="btn primary lg" onClick={() => store.unlock()}>{snap.message === 'Locked' ? 'Unlock' : 'Retry'}</button>}
      </div>
    );
  }

  const status = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : sync.syncing ? 'Syncing' : 'Not synced yet';
  const loading = sync.syncing && !sync.last && !snap.items.length;

  return (
    <div className="assistant" ref={root}>
      <div className="as-head">
        <div className="as-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'today' && today.length > 0 && <span className="seg-count">{today.length}</span>}
            </button>
          ))}
        </div>
        <button className="icon-btn" title={`${status}. Sync now`} aria-label="Sync now" onClick={() => store.syncNow()}>
          <Icon name={sync.syncing ? 'loading' : 'refresh'} spin={sync.syncing} />
        </button>
      </div>
      {sync.error && <div className="as-error" {...pressable(() => store.syncNow())}><Icon name="warning" small /> {status}</div>}

      <div className="as-scroll">
        {tab === 'today' && (
          <>
            <div className="as-filters">
              {(['all', 'work', 'personal'] as const).map((f) => (
                <button key={f} className={`chip pill outline${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : tag(f)}</button>
              ))}
            </div>
            {today.map((r) => <Task key={r.profile + r.id} row={r} onDone={() => store.done(r)} onSnooze={() => store.snooze(r)} />)}
            {!today.length && !later.length && <div className="muted as-empty">{loading ? 'Loading' : 'Nothing open'}</div>}
            {later.length > 0 && <div className="as-section">Later</div>}
            {later.map((r) => <Task key={r.profile + r.id} row={r} onDone={() => store.done(r)} onSnooze={() => store.snooze(r)} />)}
          </>
        )}
        {tab === 'capture' && <Capture onSave={(text, type, profile) => store.capture(text, type, profile)} />}
        {tab === 'notes' && (
          <>
            {notes.map((r) => (
              <div key={r.profile + r.id} className="as-note">
                <div className="as-body">
                  <div className="as-title">{r.title || '(Untitled)'}</div>
                  {r.text && <div className="as-text">{r.text}</div>}
                  <div className="as-meta"><span className={`chip sm outline as-tag ${r.profile}`}>{tag(r.profile)}</span><span>{ago(r.updated_at, ' ago')}</span></div>
                </div>
                <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => store.remove(r)}><Icon name="trash" /></button>
              </div>
            ))}
            {!notes.length && <div className="muted as-empty">No notes</div>}
          </>
        )}
      </div>
    </div>
  );
}
