import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from '../../app/store';
import { allowBlocked, answerPermission, setMode, steer } from '../chatActions';
import { Button, IconButton, ShowToggle } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Icon } from '../../ui/Icon';
import { Panel } from '../../ui/Panel';
import { pressable, useOnUnmount } from '../../ui/util';
import { touch } from '../../app/touch/touch';
import { Markdown } from '../Chat';
import { str } from '../transcript/steps';
import type { ChatEvent, PendingPermission, PendingRequest, Provider } from '../../../../shared/protocol';
import { lineDiff } from '../../../../shared/lineDiff';
import { blockedRule, canSwitchToAuto, MODE_HINTS, planApproveModes, planFeedback, planParagraphs } from './pendingLogic';
import { QuestionCard } from './QuestionCard';
import { useCardKeys } from './useCardKeys';
import { CardChat } from './cardChat';
import { editPairs } from '../../../../shared/edits';

export function Pending() {
  const pending = useStore((s) => s.pending);
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const provider = useStore((s) => s.session.provider);
  const list = useRef<HTMLDivElement>(null);
  const count = useRef(pending.length);
  // A card that is answered leaves; focus moves to the next card, or to the composer after the last.
  const lost = () => !touch() && (!document.activeElement || document.activeElement === document.body);
  useEffect(() => {
    if (pending.length < count.current && lost()) list.current?.querySelector<HTMLElement>('.pd')?.focus();
    count.current = pending.length;
  }, [pending.length]);
  useOnUnmount(() => lost() && window.dispatchEvent(new CustomEvent('agentview:focus')));
  if (!pending.length) return null;
  return (
    <div className="pd-list" ref={list}>
      {pending.map((p, n) => <PendingCard key={p.id} p={p} mode={mode} first={n === 0} auto={canSwitchToAuto(p.kind === 'question' ? '' : p.toolName, mode, provider)} provider={provider} />)}
    </div>
  );
}

export function PendingCard({ p, mode, first, auto, provider }: { p: PendingRequest; mode: string; first: boolean; auto?: boolean; provider?: Provider }) {
  if (p.kind === 'question') return <QuestionCard q={p} first={first} />;
  if (p.toolName === 'ExitPlanMode') return <PlanCard p={p} mode={mode} first={first} provider={provider} />;
  return <PermissionCard p={p} mode={mode} first={first} auto={auto} />;
}

const ICONS: Record<string, string> = {
  Bash: 'terminal', Edit: 'edit', MultiEdit: 'edit', Write: 'new-file', WebFetch: 'globe', WebSearch: 'search', Agent: 'sparkle', Task: 'sparkle',
};

type CardProps = { p: PendingPermission; mode: string; first: boolean };

function PermissionCard({ p, mode, first, auto }: CardProps & { auto?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const Body = BODIES[p.toolName] ?? RowsBody;
  return (
    <Panel ref={ref} className="pd" tabIndex={-1} role="group" aria-label={p.title}>
      <div className="pd-head">
        <Icon name={ICONS[p.toolName] ?? 'tools'} />
        <span className="pd-title" title={p.title}>{p.title}</span>
      </div>
      <Body tool={p.toolName} input={p.input} title={p.title} />
      {p.detail && <div className="pd-desc">{p.detail}</div>}
      <Decision p={p} mode={mode} first={first} cardRef={ref} yes="Allow" no="Deny" auto={auto} />
    </Panel>
  );
}

function PlanCard({ p, mode, first, provider }: CardProps & { provider?: Provider }) {
  const ref = useRef<HTMLElement>(null);
  const paragraphs = useMemo(() => planParagraphs(str(p.input.plan)), [p.input.plan]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const chat = useContext(CardChat);
  const keep = () => {
    const text = planFeedback(paragraphs, notes);
    if (text) steer(text, chat);
    else answerPermission(p.id, false, false, chat);
  };
  const save = (i: number, text: string) => {
    setNotes((n) => ({ ...n, [i]: text.trim() }));
    setEditing(null);
  };
  return (
    <Panel ref={ref} className="pd" tabIndex={-1} role="group" aria-label={p.title}>
      <div className="pd-head">
        <Icon name="checklist" />
        <span className="pd-title" title={p.title}>{p.title}</span>
      </div>
      {paragraphs.length > 0 && (
        <div className="pd-plan">
          {paragraphs.map((text, i) => (
            <div key={i} className="pd-para">
              <div className="pd-para-text" title="Comment on this" {...pressable(() => setEditing(i))}><Markdown text={text} /></div>
              {editing === i ? (
                <input
                  autoFocus
                  className="pd-other-input"
                  defaultValue={notes[i] ?? ''}
                  placeholder="Your comment, Enter to stage it"
                  aria-label="Comment on this part of the plan"
                  onBlur={(e) => save(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(i, e.currentTarget.value);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : notes[i] ? <div className="pd-note">{notes[i]}</div> : null}
            </div>
          ))}
        </div>
      )}
      {p.detail && <div className="pd-desc">{p.detail}</div>}
      <Decision p={p} mode={mode} first={first} cardRef={ref} yes="Approve" no="Keep planning" onNo={keep} modes={planApproveModes(mode, provider)} />
    </Panel>
  );
}

type ModeItem = { mode: string; label: string };

function Decision({ p, mode, first, cardRef, yes, no, onNo, auto, modes }: CardProps & { cardRef: RefObject<HTMLElement | null>; yes: string; no: string; onNo?: () => void; auto?: boolean; modes?: ModeItem[] }) {
  const always = p.canAlwaysAllow && p.toolName !== 'ExitPlanMode';
  const keys = !p.confirmFirst;
  const chat = useContext(CardChat);
  const reply = (allow: boolean, all?: boolean) => answerPermission(p.id, allow, all, chat);
  const decline = onNo ?? (() => reply(false));
  const items = modes ?? (auto ? [{ mode: 'auto', label: 'Allow and switch to Auto' }] : []);
  useCardKeys(cardRef, first, (k) => {
    if (k === 'n') decline();
    else if (k === 'y' && keys) reply(true);
    else if (k === 'a' && keys && always) reply(true, true);
    else return false;
    return true;
  });
  return (
    <>
      <div className="pd-actions">
        <Button size="sm" variant="filled" onClick={() => reply(true)}>{yes}{keys && <kbd>Y</kbd>}</Button>
        {items.length > 0 && <ModeMenu items={items} label={`More ways to ${yes.toLowerCase()}`} onPick={(m) => { setMode({ mode: m, review: null }); reply(true); }} />}
        {always && <Button size="sm" onClick={() => reply(true, true)}>Always allow{keys && <kbd>A</kbd>}</Button>}
        <Button size="sm" autoFocus={p.confirmFirst} onClick={decline}>{no}<kbd>N</kbd></Button>
      </div>
      {MODE_HINTS[mode] && <div className="pd-hint">{MODE_HINTS[mode]}</div>}
    </>
  );
}

function ModeMenu({ items, label, onPick }: { items: ModeItem[]; label: string; onPick: (mode: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={trigger} icon="chevron-down" label={label} size="sm" small aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <Menu trigger={trigger} onClose={() => setOpen(false)}>
          {items.map((it) => <MenuItem key={it.mode} icon={it.mode === 'auto' ? 'zap' : 'edit'} onClick={() => { setOpen(false); onPick(it.mode); }}>{it.label}</MenuItem>)}
        </Menu>
      )}
    </>
  );
}

type BodyProps = { tool: string; input: Record<string, unknown>; title: string };

function BashBody({ input, title }: BodyProps) {
  const description = str(input.description);
  return (
    <>
      {description && description !== title && <div className="pd-desc">{description}</div>}
      <pre className="pd-code">{str(input.command)}</pre>
    </>
  );
}

function EditBody({ tool, input }: BodyProps) {
  return (
    <>
      <div className="pd-path">{str(input.file_path)}</div>
      {(editPairs(tool, input) ?? []).map(([a, b], n) => <Diff key={n} a={a} b={b} />)}
    </>
  );
}

function WebFetchBody({ input }: BodyProps) {
  const url = str(input.url);
  const prompt = str(input.prompt);
  return (
    <>
      <a className="pd-path" href={/^https?:/i.test(url) ? url : undefined} target="_blank" rel="noreferrer">{url}</a>
      {prompt && <div className="pd-desc">{prompt}</div>}
    </>
  );
}

function WebSearchBody({ input }: BodyProps) {
  return <div className="pd-path">{str(input.query)}</div>;
}

function RowsBody({ input }: BodyProps) {
  const rows = Object.entries(input).filter(([, v]) => v !== undefined && v !== '');
  if (!rows.length) return null;
  return <div className="pd-rows">{rows.map(([k, v]) => <Row key={k} k={k} v={typeof v === 'string' ? v : JSON.stringify(v, null, 2)} />)}</div>;
}

const BODIES: Record<string, (props: BodyProps) => ReactNode> = {
  Bash: BashBody, Edit: EditBody, Write: EditBody, MultiEdit: EditBody, WebFetch: WebFetchBody, WebSearch: WebSearchBody,
};

function Row({ k, v }: { k: string; v: string }) {
  const [open, setOpen] = useState(false);
  const long = v.length > 160 || v.split('\n').length > 3;
  return (
    <>
      <span className="pd-key">{k}</span>
      <span className="pd-val">
        <span className={long && !open ? 'pd-clip' : undefined}>{v}</span>
        {long && <ShowToggle open={open} onClick={() => setOpen(!open)} />}
      </span>
    </>
  );
}

const MAX_LINES = 200;

export function Diff({ a, b }: { a: string; b: string }) {
  const lines = useMemo(() => lineDiff(a, b), [a, b]);
  return (
    <pre className="pd-diff">
      {lines.slice(0, MAX_LINES).map(([t, l], n) => <div key={n} className={t === '+' ? 'add' : t === '-' ? 'del' : undefined}>{t} {l}</div>)}
      {lines.length > MAX_LINES && <div className="pd-cut">{lines.length - MAX_LINES} more lines</div>}
    </pre>
  );
}

export function BlockedCard({ ev }: { ev: Extract<ChatEvent, { kind: 'blocked' }> }) {
  const rule = blockedRule(ev.rule);
  return (
    <Panel className="pd blocked-card">
      <div className="pd-head"><Icon name="shield" small /><span className="pd-title">Auto mode blocked this</span></div>
      <pre className="pd-code">{rule}</pre>
      {ev.reason && <div className="pd-desc">{ev.reason}</div>}
      {ev.allowed ? <div className="pd-hint">Allowed for this chat</div> : <div className="pd-actions"><Button size="sm" variant="filled" onClick={() => allowBlocked(ev.id)}>Allow and retry</Button></div>}
    </Panel>
  );
}
