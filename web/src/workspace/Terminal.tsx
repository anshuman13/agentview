import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { closeTerm, createTerm, listTerms } from './termApi';
import { notice } from '../app/store';

const Pane = lazy(() => import('./TermPane').then((m) => ({ default: m.Pane })));

type Tab = { id: string; name: string };
type Props = { chat: string; project?: string; open: boolean; onToggle: () => void };

const KEYS: [label: string, seq: string, icon?: string][] = [
  ['Esc', '\x1b'],
  ['Tab', '\t'],
  ['^C', '\x03'],
  ['^D', '\x04'],
  ['Up', '\x1b[A', 'arrow-up'],
  ['Down', '\x1b[B', 'arrow-down'],
  ['Left', '\x1b[D', 'arrow-left'],
  ['Right', '\x1b[C', 'arrow-right'],
];

type BarProps = { tabs: Tab[]; active: string; pick: (id: string) => void; close: (id: string) => Promise<void>; add: () => Promise<void>; clear: () => void; max: boolean; toggleMax: () => void };

function TermBar({ tabs, active, pick, close, add, clear, max, toggleMax }: BarProps) {
  return (
    <span className="term-bar" onClick={(e) => e.stopPropagation()}>
      {tabs.map((t) => (
        <span key={t.id} className={`term-tab${t.id === active ? ' on' : ''}`} onClick={() => pick(t.id)} title={t.name}>
          <Icon name="terminal" small />
          <button className="term-tab-name" aria-pressed={t.id === active}>{t.name}</button>
          <button className="icon-btn" title="Kill terminal" aria-label={`Kill ${t.name}`} onClick={(e) => { e.stopPropagation(); close(t.id).catch(() => notice('Could not close the terminal')); }}><Icon name="close" small /></button>
        </span>
      ))}
      <button className="icon-btn" title="New terminal" onClick={() => add().catch(() => notice('Terminal unavailable'))}><Icon name="add" small /></button>
      <button className="icon-btn" title="Clear (⌘K)" onClick={clear}><Icon name="clear-all" small /></button>
      <button className="icon-btn" title={max ? 'Restore panel size' : 'Maximize panel size'} onClick={toggleMax}><Icon name={max ? 'screen-normal' : 'screen-full'} small /></button>
    </span>
  );
}

function TermKeys({ send }: { send: (seq: string) => void }) {
  return (
    <div className="term-keys mobile-only">
      {KEYS.map(([label, seq, icon]) => (
        <button key={label} title={label} onPointerDown={(e) => e.preventDefault()} onClick={() => send(seq)}>
          {icon ? <Icon name={icon} small /> : label}
        </button>
      ))}
      <button title="Paste" onPointerDown={(e) => e.preventDefault()} onClick={() => (navigator.clipboard?.readText() ?? Promise.reject()).then((t) => t && send(t)).catch(() => notice('Could not read the clipboard'))}>Paste</button>
    </div>
  );
}

// The terminal tabs of a chat: loaded from the server, opened on first show, and reattached after a server restart.
function useTermTabs(chat: string, open: boolean, onToggle: () => void) {
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [active, setActive] = useState('');
  const [focus, setFocus] = useState(0);
  const [gens, setGens] = useState<Record<string, number>>({});
  const wasOpen = useRef(open);
  const starting = useRef(false);
  const retries = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      retries.current.forEach(clearTimeout);
    };
  }, []);
  const load = async () => {
    const list: Tab[] = await listTerms(chat).then((r) => r.json());
    setTabs(list);
    setActive((a) => (list.some((t) => t.id === a) ? a : (list[list.length - 1]?.id ?? '')));
    return list;
  };

  const add = async () => {
    const t: Tab = await createTerm(chat).then((r) => r.json());
    setTabs((l) => [...(l ?? []), t]);
    setActive(t.id);
    setFocus((f) => f + 1);
  };

  const close = async (id: string) => {
    await closeTerm(chat, id);
    if ((await load()).length === 0) onToggle();
  };

  const gone = async (id: string) => {
    const list = await load().catch(() => null);
    if (!alive.current) return;
    // Server restarting: try again until it answers, then reattach.
    if (!list) return void retries.current.set(id, setTimeout(() => gone(id), 2000));
    retries.current.delete(id);
    if (list.some((t) => t.id === id)) setGens((g) => ({ ...g, [id]: (g[id] ?? 0) + 1 }));
    else if (list.length === 0) onToggle();
  };

  useEffect(() => {
    if (!open || !chat || starting.current) return;
    if (tabs?.length) return;
    starting.current = true;
    (tabs ? add() : load().then((l) => (l.length ? undefined : add()))).catch(() => {}).finally(() => (starting.current = false));
  }, [open, chat]);

  useEffect(() => {
    if (open && !wasOpen.current) setFocus((f) => f + 1);
    wasOpen.current = open;
  }, [open]);

  const pick = (id: string) => {
    setActive(id);
    setFocus((f) => f + 1);
  };
  return { tabs, active, focus, gens, add, close, gone, pick };
}

export function Terminal({ chat, project, open, onToggle }: Props) {
  const { tabs, active, focus, gens, add, close, gone, pick } = useTermTabs(chat, open, onToggle);
  const [max, setMax] = useState(false);
  const clears = useRef(new Map<string, () => void>());
  const inputs = useRef(new Map<string, (d: string) => void>());

  return (
    <>
      <div className={`panel-head${open && max ? ' term-max' : ''}`} onClick={onToggle} title="Toggle the terminal (⌘J)">
        <Icon name="terminal" small />
        <span className="panel-title">Terminal</span>
        <span className="muted">{project}</span>
        <span className="spacer" />
        {open && tabs && (
          <TermBar tabs={tabs} active={active} pick={pick} close={close} add={add} clear={() => clears.current.get(active)?.()} max={max} toggleMax={() => setMax((m) => !m)} />
        )}
        <button className="icon-btn term-toggle" aria-label="Terminal" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <Icon name={open ? 'chevron-down' : 'chevron-up'} small />
        </button>
      </div>
      {chat && tabs && (
        <div className="panel-body" hidden={!open}>
          <div className="term-stack">
            <Suspense fallback={null}>
              {tabs.map((t) => (
                <Pane key={`${t.id}:${gens[t.id] ?? 0}`} id={t.id} on={t.id === active} focus={t.id === active ? focus : 0} clears={clears.current} inputs={inputs.current} onGone={() => void gone(t.id)} />
              ))}
            </Suspense>
          </div>
          <TermKeys send={(seq) => inputs.current.get(active)?.(seq)} />
        </div>
      )}
    </>
  );
}
