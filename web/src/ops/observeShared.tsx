import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ObserveInfo } from '../../../shared/observe';
import { api } from '../app/store';
import { fetchJson } from '../app/api';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Section as UiSection } from '../ui/Section';
import { errText } from '../../../shared/util';
import '../styles/features/observe.css';
import '../styles/features/wiki.css';
import '../styles/features/meetings.css';

export const post = <T,>(url: string, body: unknown) => fetchJson<T>(api(url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });


export type Load<T> = { data: T | null; error: string; busy: boolean };

// The latest request per Load state; an older answer that lands later is dropped.
const latest = new WeakMap<object, number>();
export const bump = (set: object) => {
  const n = (latest.get(set) ?? 0) + 1;
  latest.set(set, n);
  return n;
};

// Mirrors a request into a Load state: busy while it runs, then data or error.
export function track<T>(set: (l: Load<T>) => void, request: () => Promise<T>) {
  const n = bump(set);
  set({ data: null, error: '', busy: true });
  request().then(
    (data) => latest.get(set) === n && set({ data, error: '', busy: false }),
    (e) => latest.get(set) === n && set({ data: null, error: errText(e), busy: false }),
  );
}

export function useLoad<T>(url: string | null): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ data: null, error: '', busy: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setState({ data: null, error: '', busy: true });
    fetchJson<T>(api(url)).then(
      (data) => live && setState({ data, error: '', busy: false }),
      (e) => live && setState({ data: null, error: e.message, busy: false }),
    );
    return () => {
      live = false;
    };
  }, [url, tick]);
  return [state, () => setTick((t) => t + 1)];
}

export const Loading = () => <div className="obs-hint"><Icon name="loading" small spin /> Loading</div>;
export const Err = ({ text }: { text: string }) => (text ? <div className="obs-hint error" role="alert">{text}</div> : null);

export function Pane({ label, action, open: initial = true, children }: { label: string; action?: ReactNode; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <UiSection label={label} action={action} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && <div className="obs-body">{children}</div>}
    </>
  );
}

export function SubHead({ label, link, linkLabel, ask }: { label: string; link?: string; linkLabel: string; ask?: () => void }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const action =
    link && ask ? (
      <span className="as-wrap-more">
        <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" small aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
        {menu && (
          <Menu trigger={btn} onClose={() => setMenu(false)}>
            <MenuItem icon="link-external" href={link} onClick={() => setMenu(false)}>{linkLabel}</MenuItem>
            <MenuItem icon="sparkle" onClick={() => { setMenu(false); ask(); }}>Ask Claude</MenuItem>
          </Menu>
        )}
      </span>
    ) : link ? (
      <IconButton href={link} icon="link-external" label={linkLabel} size="sm" small />
    ) : ask ? (
      <IconButton icon="sparkle" label="Ask Claude" size="sm" small onClick={ask} />
    ) : undefined;
  return <UiSection label={label} action={action} />;
}

export function Sub({ title, link, ask, children }: { title: string; link?: string; ask?: () => void; children: ReactNode }) {
  return (
    <div className="obs-sub">
      <SubHead label={title} link={link} linkLabel="Open in Grafana" ask={ask} />
      {children}
    </div>
  );
}

export function AddToClaude({ server, added, disabled, title, onDone }: { server: 'snowflake'; added: boolean; disabled?: boolean; title: string; onDone: (i: ObserveInfo) => void }) {
  const [msg, setMsg] = useState('');
  if (added) return <span className="chip st-ok" title={`${server} is in ~/.claude.json`}><Icon name="check" small /> In Claude</span>;
  return (
    <span className="obs-add">
      <button className="btn xs" disabled={disabled} title={title} onClick={() => post<{ info: ObserveInfo }>('/api/observe/mcp/add', { server }).then((r) => onDone(r.info), (e) => setMsg(e.message))}>
        <Icon name="add" small /> Add to Claude
      </button>
      {msg && <span className="error" role="alert">{msg}</span>}
    </span>
  );
}


export const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
