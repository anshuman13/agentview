import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { readFlag, saveFlag } from '../ui/util';
import { useChromeSocket, type ChromeState, type Tab } from './useChromeSocket';
import { useFrameInput } from './useFrameInput';

type Send = (m: object) => unknown;

type BarProps = { send: Send; tabs: Tab[]; tab: Tab | undefined; pinned: string | null; phone: boolean; setPhone: (v: boolean) => void; focusKeyboard: () => void; goFull: () => void };

function BrowserBar({ send, tabs, tab, pinned, phone, setPhone, focusKeyboard, goFull }: BarProps) {
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
      <button className="icon-btn" title="Back" onClick={() => send({ t: 'back' })}><Icon name="arrow-left" /></button>
      <button className="icon-btn desktop-only" title="Forward" onClick={() => send({ t: 'forward' })}><Icon name="arrow-right" /></button>
      <button className="icon-btn" title="Reload" onClick={() => send({ t: 'reload' })}><Icon name="refresh" /></button>
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
      <button
        className={`icon-btn phone-only${phone ? ' on' : ''}`}
        title={phone ? 'Phone layout is on. Chrome on the Mac shows the page at phone size' : 'Show the page at phone size. Chrome on the Mac shrinks while this is on'}
        aria-pressed={phone}
        onClick={() => setPhone(!phone)}
      ><Icon name="device-mobile" /></button>
      <button className="icon-btn phone-only" title="Keyboard" onClick={focusKeyboard}><Icon name="keyboard" /></button>
      <button className="icon-btn phone-only" title="Full screen" onClick={goFull}><Icon name="screen-full" /></button>
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

  useEffect(() => {
    document.body.classList.toggle('browser-full', full);
    return () => document.body.classList.remove('browser-full');
  }, [full]);

  if (state.state !== 'on') return <Connect state={state} onSetup={() => send({ t: 'setup' })} />;

  return (
    <div className="browser-pane">
      <BrowserBar
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
        {full && <button className="icon-btn browser-exit" title="Exit full screen" onClick={() => setFull(false)}><Icon name="screen-normal" /></button>}
        <img
          ref={img}
          className="chrome-frame"
          alt=""
          hidden={!hasFrame}
          draggable={false}
          onPointerDown={input.onDown}
          onPointerMove={input.onMove}
          onPointerUp={input.onUp}
          onPointerCancel={input.onCancel}
          onWheel={input.onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {!hasFrame && (
          <EmptyState size="md" icon="globe" title={tabs.length ? 'Waiting for the tab to draw' : 'No tab open in Chrome'} hint="Chrome only draws the tab that is in front. Pick a tab above to bring it forward" />
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
