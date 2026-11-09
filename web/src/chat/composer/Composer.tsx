import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { send, useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { touch } from '../../app/touch/touch';
import { PERMISSION_MODES } from '../../../../shared/protocol';
import { LoopCard } from '../cards/LoopCard';
import { TodoCard } from '../cards/TodoCard';
import { useDictation } from './Voice';
import { PopItems } from './ComposerPop';
import { Announcer } from '../Announcer';
import { ChatSettings, useChatSettings, type Pick } from '../ChatSettings';
import { accept, ghostFor, goalPlaceholder, type GoalChoice, type Use } from './composerLogic';
import { ComposerFoot } from './ComposerFoot';
import { ComposerStats } from './ComposerStats';
import { PickerSheets } from './PickerSheets';
import { SharedConfirm, useSharedIntake } from './SharedText';
import { UsesBar } from './UsesBar';
import { useAutocomplete } from './useAutocomplete';
import { useComposerEvents } from './useComposerEvents';
import { useDraft, usePromptHistory } from './usePromptHistory';
import { useSubmit } from './useSubmit';
import { useUploads } from './useUploads';

const MAX_HEIGHT = 220;

function useAutoHeight(ta: RefObject<HTMLTextAreaElement | null>, mirror: RefObject<HTMLDivElement | null>, wantCaret: { current: number | null }, setCaret: (n: number) => void, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, mirror.current?.offsetHeight ?? 0);
    el.style.height = `${Math.min(h, MAX_HEIGHT)}px`;
    if (mirror.current) mirror.current.style.visibility = h > MAX_HEIGHT ? 'hidden' : '';
    if (wantCaret.current !== null) {
      el.setSelectionRange(wantCaret.current, wantCaret.current);
      setCaret(wantCaret.current);
      wantCaret.current = null;
    }
  }, deps);
}

function placeholderFor(running: boolean, waiting: boolean, compacting: boolean, goal: GoalChoice, hasUses: boolean) {
  if (waiting) return 'Answer below, or message Claude to stop and send';
  if (compacting) return 'Sends when compacting is done';
  if (running) return touch() ? 'Claude reads this next · hold Send to stop' : 'Claude reads this at its next step · ⌘Enter stops and sends';
  if (goal !== 'off') return goalPlaceholder;
  return hasUses ? 'What should Claude do with it?' : 'Ask anything · / commands · @ files · @chat: chats';
}

export function Composer() {
  const chat = useStore((s) => s.session.id);
  const running = useStore((s) => s.session.running);
  const compacting = useStore((s) => s.session.compacting);
  const waiting = useStore((s) => s.pending.length > 0);
  const { mode } = useChatSettings();
  const [pick, setPick] = useState<Pick | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const [goals, setGoals] = useState<Record<string, GoalChoice>>({});
  const goal = goals[chat] ?? 'off';
  const [caret, setCaret] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const wantCaret = useRef<number | null>(null);
  const popId = useId();
  const [text, setText] = useDraft(chat, () => { setUses([]); h.setHist(null); setPick(null); });
  const h = usePromptHistory(chat);
  const ac = useAutocomplete(text, caret);
  const dictate = useDictation(text, setText);
  const { uploading, attach } = useUploads(setText, ta);
  const [shared, setShared] = useSharedIntake(attach);
  useComposerEvents({ ta, wantCaret, setText, setUses });

  const ghost = !ac.open && !ac.shell && ac.at === text.length ? ghostFor(text, h.history) : '';
  const typed = text.trim().length > 0;
  useAutoHeight(ta, mirror, wantCaret, setCaret, [text, ghost]);

  const apply = (next: string, c = next.length) => {
    wantCaret.current = c;
    setText(next);
  };
  const submit = useSubmit({
    text, setText, shell: ac.shell, uploading, uses, setUses, goal, apply,
    resetGoal: () => setGoals((g) => ({ ...g, [chat]: 'off' })),
    sentHistory: h.sentHistory, setSentHistory: h.setSentHistory, clearHistoryStep: () => h.setHist(null),
  });

  const choose = (i: number) => {
    if (!ac.trigger || ac.trigger.kind === 'shell' || !ac.items[i]) return;
    const it = ac.items[i].item;
    const value = ac.trigger.kind === 'command' ? `/${(it as { name: string }).name}` : typeof it === 'object' && 'sessionId' in it ? `@chat:${it.sessionId}` : `@${it as string}`;
    const r = accept(text, ac.trigger.start, ac.at, value);
    apply(r.text, r.caret);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const onEntry = h.hist !== null && text === h.hist.list[h.hist.index];
    if (ac.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); ac.setSel((i) => (i + 1) % ac.items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); ac.setSel((i) => (i - 1 + ac.items.length) % ac.items.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); ac.setDismissed(ac.popKey); return; }
      const exact = ac.trigger?.kind === 'command' && (ac.items[ac.sel]?.item as { name: string } | undefined)?.name === ac.trigger.query;
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !exact)) { e.preventDefault(); choose(ac.sel); return; }
    }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); send({ type: 'set_permission_mode', mode: PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode as never) + 1) % PERMISSION_MODES.length] }); return; }
    if (ghost && (e.key === 'Tab' || e.key === 'ArrowRight') && el.selectionStart === text.length) { e.preventDefault(); apply(text + ghost); return; }
    if (e.key === 'ArrowUp' && (text === '' || onEntry) && !text.slice(0, el.selectionStart).includes('\n')) { e.preventDefault(); h.step(1, text, apply); return; }
    if (e.key === 'ArrowDown' && onEntry && !text.slice(el.selectionEnd).includes('\n')) { e.preventDefault(); h.step(-1, text, apply); return; }
    if (e.key === 'Enter' && !e.shiftKey && (!touch() || e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
  };

  return (
    <div className="cp" data-mode={mode}>
      {shared !== null && <SharedConfirm shared={shared} setShared={setShared} setText={setText} />}
      <TodoCard />
      <LoopCard />
      <div
        ref={ac.card}
        className={`cp-card${ac.shell ? ' shell' : ''}`}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach([...e.dataTransfer.files]); } }}
      >
        <UsesBar uses={uses} remove={(u) => setUses((l) => l.filter((x) => x !== u))} />
        <div className="cp-text">
          <div ref={mirror} className="cp-mirror" aria-hidden><span className="cp-typed">{text}</span><span className="cp-ghost">{ghost}</span></div>
          <textarea
            ref={ta}
            value={text}
            rows={1}
            aria-label="Message Claude"
            aria-autocomplete="list"
            aria-controls={ac.open ? popId : undefined}
            aria-activedescendant={ac.open ? `${popId}-${ac.sel}` : undefined}
            placeholder={placeholderFor(running, waiting, compacting, goal, uses.length > 0)}
            spellCheck={!ac.shell}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            enterKeyHint={touch() ? 'enter' : undefined}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach([...e.clipboardData.files]); } }}
          />
        </div>
        {ghost && touch() && (
          <button className="cp-suggest" title="Use this suggestion" onPointerDown={(e) => e.preventDefault()} onClick={() => apply(text + ghost)}>
            <Icon name="arrow-right" small /><span>{text.length > 12 && '…'}{text.slice(-12)}<b>{ghost}</b></span>
          </button>
        )}
        <ComposerFoot goal={goal} uses={uses} uploading={uploading} typed={typed} shell={ac.shell} setPick={setPick} attach={attach} dictate={dictate} submit={submit} />
      </div>
      <ComposerStats hint={ac.shell ? 'Runs in the terminal' : ''} />
      {ac.open && (
        <ul ref={ac.pop} id={popId} className="cp-pop" role="listbox" aria-label={ac.trigger?.kind === 'command' ? 'Commands' : 'Files'}>
          <PopItems items={ac.items} kind={ac.trigger?.kind} popId={popId} sel={ac.sel} choose={choose} />
        </ul>
      )}
      <Announcer key={chat} />
      <ChatSettings pick={pick} setPick={setPick} savedCount={h.sentHistory.length} goal={goal} setGoal={(c) => setGoals((g) => ({ ...g, [chat]: c }))} />
      <PickerSheets pick={pick} setPick={setPick} sentHistory={h.sentHistory} setUses={setUses} apply={apply} focus={() => ta.current?.focus()} />
    </div>
  );
}
