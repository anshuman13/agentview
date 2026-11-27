import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cancelUnsent, queuedFor, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Button, IconButton, ShowToggle } from '../../ui/Button';
import { readBox, saveBox } from './boxOpen';
import { copyPrompt, insertText, sendNow } from '../chatActions';
import { imageUrl } from '../chatApi';
import { userParts } from '../composer/composerLogic';
import type { Item } from './steps';

const FOLD_LINES = 6;

// Text clamped at FOLD_LINES with Show more on overflow; the open state is kept under `id`.
function Folded({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(() => readBox(id, false));
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLong(el.scrollHeight > FOLD_LINES * parseFloat(getComputedStyle(el).lineHeight) + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);
  const toggle = () => { saveBox(id, !open); setOpen(!open); };
  return (
    <>
      <div ref={ref} className={`${className}${open ? '' : ' folded'}`}>{children}</div>
      {long && <ShowToggle open={open} onClick={toggle} />}
    </>
  );
}

export function UserImage({ path }: { path: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {!loaded && <span className="tr-image-tag">Image: {path.split('/').pop()}</span>}
      {!failed && <img className="tr-image" hidden={!loaded} src={imageUrl(path)} alt={path} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </>
  );
}

function UserText({ id, text }: { id: string; text: string }) {
  const parts = useMemo(() => userParts(text), [text]);
  return (
    <Folded id={'prompt-' + id} className="tr-user-text">
      {parts.map((p, i) => ('image' in p ? <UserImage key={i} path={p.image} /> : <div key={i}>{p.text}</div>))}
    </Folded>
  );
}

export function UnsentRows() {
  const outbox = useStore((s) => s.outbox);
  const chat = useStore((s) => s.session.id);
  return <>{queuedFor(outbox, chat).map((q) => (
    <div key={q.id} className="tr-user unsent"><UserText id={q.id} text={q.text} /><span className="tr-stop"><Icon name="clock" small />Waiting to send<Button variant="plain" size="sm" onClick={() => cancelUnsent(q.id)}>Cancel</Button></span></div>
  ))}</>;
}

export function UserRow({ it, label, readOnly }: { it: Extract<Item, { kind: 'user' }>; label: string; readOnly?: boolean }) {
  return (
    <div id={`turn-${it.id}`} className={`tr-user ${it.stopping ? 'stopping' : ''} ${it.queued ? 'queued' : ''}`}>
      {it.voice && <span className="tr-mic" title="Spoken"><Icon name="mic" small /></span>}
      <UserText id={it.id} text={it.text} />
      {it.stopping && <span className="tr-stop"><Icon name="loading" small spin />{`Stopping ${label} to send this`}</span>}
      {it.queued && <span className="tr-stop"><Icon name="clock" small />{`Waiting for ${label}'s next step`}<Button variant="plain" size="sm" className="tl-send-now" title={`Stop ${label}'s current step and send this now`} onClick={() => sendNow(it.id)}>Send now</Button></span>}
      {!it.stopping && !it.queued && !readOnly && <span className="tr-acts"><IconButton icon="reply" label="Use again" onClick={() => insertText(it.text)} /><IconButton icon="copy" label="Copy" onClick={() => copyPrompt(it.text)} /></span>}
    </div>
  );
}
