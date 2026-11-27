import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { useLoad, type Load } from '../ui/useLoad';
import { ago, readFlag, saveFlag } from '../ui/util';
import { fetchDevServers, type DevServer } from './fileApi';
import { useChromeSocket, type ChromeState, type Tab } from './useChromeSocket';
import { useFrameInput } from './useFrameInput';
import { Markup } from './Markup';

type Send = (m: object) => unknown;

const devServerUrl = (port: number) => `http://localhost:${port}`;
const startedText = (at: number) => (at ? `Started ${ago(at, ' ago').replace(/^now$/, 'just now')}` : '');

// Dev servers (Claude.app's servers button): TCP ports listening on localhost whose process runs in the chat's folder.
function ServersButton({ open }: { open: (url: string) => void }) {
  const [shown, setShown] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [load] = useLoad(shown ? fetchDevServers : null, String(shown));
  const pick = (url: string) => { setShown(false); open(url); };
  return (
    <div className="browser-servers">
      <IconButton ref={trigger} icon="server-process" label="Dev servers" title="Dev servers running from this chat's folder" on={shown} onClick={() => setShown((v) => !v)} />
      {shown && (
        <Menu trigger={trigger} onClose={() => setShown(false)}>
          {load.busy || !load.data ? (
            <MenuItem icon={load.error ? 'warning' : 'loading'} spin={!load.error} disabled>{load.error || 'Looking for dev servers…'}</MenuItem>
          ) : !load.data.length ? (
            <MenuItem icon="server-process" disabled>No dev servers running in this folder</MenuItem>
          ) : load.data.map((s) => (
            <MenuItem key={s.port} icon="server-process" className="dev-server-row" title={`${devServerUrl(s.port)} · ${s.cwd}`} onClick={() => pick(devServerUrl(s.port))}>
              {s.name} :{s.port}<span className="muted">{startedText(s.startedAt)}</span>
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

function DevServerList({ load, open }: { load: Load<DevServer[]>; open: (url: string) => void }) {
  if (!load.data?.length) return null;
  return (
    <div className="dev-servers">
      {load.data.map((s) => (
        <Row key={s.port} leading={<Icon name="server-process" />} title={`${s.name} :${s.port}`} meta={startedText(s.startedAt)} lines={1} onClick={() => open(devServerUrl(s.port))} />
      ))}
    </div>
  );
}

type BarProps = { picking: boolean; setPicking: (v: boolean) => void; marking: boolean; setMarking: (v: boolean) => void; send: Send; tabs: Tab[]; tab: Tab | undefined; pinned: string | null; phone: boolean; setPhone: (v: boolean) => void; focusKeyboard: () => void; goFull: () => void };

function BrowserBar({ picking, setPicking, marking, setMarking, send, tabs, tab, pinned, phone, setPhone, focusKeyboard, goFull }: BarProps) {
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setUrl(tab?.url ?? '');
  }, [tab?.url, editing]);
  const go = () => {
    setEditing(false);
    if (url.trim()) send({ t: 'nav', url: url.trim() });
  };
  return (
    <div className="pane-bar browser-bar">
      <IconButton icon="arrow-left" label="Back" onClick={() => send({ t: 'back' })} />
      <IconButton icon="arrow-right" label="Forward" className="desktop-only" onClick={() => send({ t: 'forward' })} />
      <IconButton icon="refresh" label="Reload" onClick={() => send({ t: 'reload' })} />
      <input
        className="url"
        placeholder="Address"
        aria-label="Address"
        value={url}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { go(); e.currentTarget.blur(); }
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
      <select className="tab-pick" value={pinned ?? ''} onChange={(e) => send({ t: 'tab', id: e.target.value || null })} title="Which Chrome tab to show">
        <option value="">Follow Claude</option>
        {tabs.map((t) => <option key={t.id} value={t.id}>{t.title || t.url}</option>)}
      </select>
      <ServersButton open={(u) => send({ t: 'nav', url: u })} />
      <IconButton icon="inspect" label="Pick an element" on={picking} aria-pressed={picking} title={picking ? 'Click an element to add it to the prompt. Esc ends picking' : 'Pick an element on the page and add it to the prompt'} onClick={() => setPicking(!picking)} />
      <IconButton icon="edit" label="Mark up" on={marking} aria-pressed={marking} title={marking ? 'Close markup. Esc also closes it' : 'Draw on the page and add it to the chat'} onClick={() => setMarking(!marking)} />
      {tab && <IconButton icon="close" label="Close tab" title="Close this tab in Chrome" onClick={() => send({ t: 'close', id: tab.id })} />}
      <IconButton
        icon="device-mobile"
        label="Phone layout"
        className="phone-only"
        on={phone}
        title={phone ? 'Phone layout is on. Chrome on the Mac shows the page at phone size' : 'Show the page at phone size. Chrome on the Mac shrinks while this is on'}
        aria-pressed={phone}
        onClick={() => setPhone(!phone)}
      />
      <IconButton icon="keyboard" label="Keyboard" className="phone-only" onClick={focusKeyboard} />
      <IconButton icon="screen-full" label="Full screen" className="phone-only" onClick={goFull} />
    </div>
  );
}

export function BrowserPane({ onEmpty }: { onEmpty?: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const kbd = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [phone, setPhone] = useState(() => readFlag('browser-phone', false));
  const { send, vp, state, tabs, current, pinned, hasFrame } = useChromeSocket({ img, kbd, host }, phone, onEmpty);
  const input = useFrameInput(send, img, kbd, vp);
  const [picking, setPickingNow] = useState(false);
  const [marking, setMarkingNow] = useState(false);
  const setPicking = (v: boolean) => { setPickingNow(v); if (v) setMarkingNow(false); };
  const setMarking = (v: boolean) => { setMarkingNow(v); if (v) setPickingNow(false); };
  const on = state.state === 'on';
  const [servers] = useLoad(on && !hasFrame ? fetchDevServers : null, `${on}-${hasFrame}`);

  // Pick mode: the pointer outlines the element under it in Chrome, a click or tap adds it to the prompt, Esc ends it.
  useEffect(() => {
    if (!picking || !on) return;
    send({ t: 'pick', on: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setPicking(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      send({ t: 'pick', on: false });
    };
  }, [picking, on, current]);
  const frameEvents = picking
    ? {
        onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); send({ t: 'pickAt', ...input.pos(e) }); },
        onPointerMove: (e: React.PointerEvent) => e.pointerType === 'mouse' && send({ t: 'pickHover', ...input.pos(e) }),
      }
    : { onPointerDown: input.onDown, onPointerMove: input.onMove, onPointerUp: input.onUp, onPointerCancel: input.onCancel };

  useEffect(() => {
    document.body.classList.toggle('browser-full', full);
    return () => document.body.classList.remove('browser-full');
  }, [full]);

  if (state.state !== 'on') return <Connect state={state} onSetup={() => send({ t: 'setup' })} />;

  return (
    <div className="browser-pane">
      <BrowserBar
        picking={picking}
        setPicking={setPicking}
        marking={marking}
        setMarking={setMarking}
        send={send}
        tabs={tabs}
        tab={tabs.find((t) => t.id === current)}
        pinned={pinned}
        phone={phone}
        setPhone={(v) => { setPhone(v); saveFlag('browser-phone', v); }}
        focusKeyboard={() => kbd.current?.focus()}
        goFull={() => setFull(true)}
      />
      <div className="frame-host" ref={host}>
        {full && <IconButton icon="screen-normal" label="Exit full screen" className="browser-exit" onClick={() => setFull(false)} />}
        <img
          ref={img}
          className={`chrome-frame${picking ? ' picking' : ''}`}
          alt=""
          hidden={!hasFrame}
          draggable={false}
          {...frameEvents}
          onWheel={input.onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {marking && hasFrame && <Markup img={img} onClose={() => setMarkingNow(false)} />}
        {!hasFrame && (
          <EmptyState size="md" icon="globe" title={tabs.length ? 'Waiting for the tab to draw' : 'No tab open in Chrome'} hint="Chrome only draws the tab that is in front. Pick a tab above to bring it forward" action={<DevServerList load={servers} open={(u) => send({ t: 'nav', url: u })} />} />
        )}
        <textarea ref={kbd} className="chrome-kbd" aria-label="Type into the page" autoCapitalize="off" autoComplete="off" spellCheck={false} onKeyDown={input.onKey} onInput={input.onText} onPaste={(e) => { e.preventDefault(); send({ t: 'text', text: e.clipboardData.getData('text') }); }} />
      </div>
    </div>
  );
}

const REASONS: Record<string, string> = {
  nofda: 'macOS blocks AgentView from finding Chrome. AgentView needs Full Disk Access, and macOS forgets it each time AgentView is rebuilt.',
  nochrome: 'Chrome is not running.',
  disabled: 'Chrome is running, but remote debugging is off.',
  denied: 'Chrome refused the connection.',
  timeout: 'Chrome did not answer in time.',
  closed: 'The connection to Chrome closed.',
  server: 'The AgentView server is not reachable.',
};

function Connect({ state, onSetup }: { state: ChromeState; onSetup: () => void }) {
  const [asked, setAsked] = useState(false);
  if (state.state === 'connecting') {
    return (
      <div className="browser-pane">
        <EmptyState size="md" icon="loading" title="Connecting to Chrome…" hint={state.own ? undefined : 'If Chrome asks to allow remote debugging, click Allow'} />
      </div>
    );
  }
  const fda = state.reason === 'nofda';
  return (
    <div className="browser-pane">
      <EmptyState
        size="md"
        icon="globe"
        title="Show your Chrome here"
        hint={<>
          <div>{state.own && state.reason === 'nochrome' ? 'The AgentView Chrome is not running.' : (REASONS[state.reason] ?? state.reason)}</div>
          {asked && (
            <div>
              {state.own
                ? 'AgentView opens its own Chrome window and connects on its own.'
                : fda
                ? 'If AgentView is already in the Full Disk Access list, select it and remove it with the minus button. Then drag AgentView from the Finder window into the list and turn it on. AgentView connects on its own; if it does not, quit and reopen it from the menu bar.'
                : 'In the Chrome tab that opened, tick "Allow remote debugging for this browser instance", then click Allow. AgentView connects on its own.'}
            </div>
          )}
        </>}
        action={state.reason !== 'server' ? (
          <Button variant="primary" size="sm" onClick={() => { setAsked(true); onSetup(); }}>
            {fda ? 'Open Full Disk Access settings' : 'Connect Chrome'}
          </Button>
        ) : undefined}
      />
    </div>
  );
}
