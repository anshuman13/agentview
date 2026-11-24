import { memo, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { touch } from '../../app/touch/touch';
import { useNarrow } from '../../app/shell/useNarrow';
import { recognizer, useDictation, Voice } from './Voice';
import { AddMenu } from './AddMenu';
import { PopItems } from './ComposerPop';
import { Announcer } from '../Announcer';
import { ChatSettings, useChatSettings, type Pick } from '../ChatSettings';
import { ghostFor, joinMarks, splitMarks, type Use } from './composerLogic';
import { AttachmentsBar } from './AttachmentsBar';
import { ComposerFoot, SendButton } from './ComposerFoot';
import { ComposerStats } from './ComposerStats';
import { PickerSheets } from './PickerSheets';
import { SharedConfirm, useSharedIntake } from './SharedText';
import { UsesBar } from './UsesBar';
import { useAutocomplete } from './useAutocomplete';
import { useAutoHeight } from './useAutoHeight';
import { useBarHidden } from './useBarHidden';
import { useCan } from '../useCan';
import { useComposerEvents } from './useComposerEvents';
import { useComposerKeys } from './useComposerKeys';
import { useDraft, usePromptHistory } from './usePromptHistory';
import { useSubmit } from './useSubmit';
import { useUploads } from './useUploads';
import { providerLabel } from '../../../../shared/providers';
import { composerPlaceholder } from '../../../../shared/composerText';
import { QUICK_REPLIES, quickReplies } from '../../../../shared/quickReplies';
import { Chip } from '../../ui/Button';

function placeholderFor(label: string, running: boolean, waiting: boolean, compacting: boolean, hasUses: boolean, narrow: boolean) {
  const state = waiting ? 'waiting' : compacting ? 'compacting' : running ? 'running' : hasUses ? 'uses' : 'idle';
  return composerPlaceholder(label, state, narrow ? 'narrow' : touch() ? 'touch' : 'desktop', recognizer() !== undefined);
}

export const Composer = memo(function Composer() {
  const chat = useStore((s) => s.session.id);
  const sessionId = useStore((s) => s.session.sessionId);
  const running = useStore((s) => s.session.running);
  const label = useStore((s) => providerLabel(s.session.provider));
  const compacting = useStore((s) => s.session.compacting);
  const waiting = useStore((s) => s.pending.length > 0);
  const asked = useStore((s) => quickReplies(s.events).length > 0);
  const { mode, modes } = useChatSettings();
  const [pick, setPick] = useState<Pick | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const narrow = useNarrow();
  const [caret, setCaret] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const canEffort = useCan('effort');
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const wantCaret = useRef<number | null>(null);
  const popId = useId();
  const [full, setFull] = useDraft(chat, sessionId, () => { setUses([]); h.setHist(null); setPick(null); });
  const { body: text, marks } = splitMarks(full);
  const setText: Dispatch<SetStateAction<string>> = (next) => setFull((f) => {
    const s = splitMarks(f);
    return joinMarks(typeof next === 'function' ? next(s.body) : next, s.marks);
  });
  const setMarks = (change: (marks: string[]) => string[]) => setFull((f) => {
    const s = splitMarks(f);
    return joinMarks(s.body, change(s.marks));
  });
  const h = usePromptHistory(chat);
  const ac = useAutocomplete(text, caret);
  const dictate = useDictation(text, setText);
  const { uploading, attach } = useUploads((m) => setMarks((l) => [...l, m]), ta);
  const [shared, setShared] = useSharedIntake(attach);

  const ghost = !ac.open && !ac.shell && ac.at === text.length ? ghostFor(text, h.history) : '';
  const typed = full.trim().length > 0;
  const multi = useAutoHeight(ta, mirror, wantCaret, setCaret, [text, ghost]);
  useBarHidden(ta, typed);

  const apply = (next: string, c?: number) => {
    const s = splitMarks(next);
    wantCaret.current = c ?? s.body.length;
    setFull(joinMarks(s.body, s.marks.length ? s.marks : marks));
  };
  const applyFull = (next: string) => {
    wantCaret.current = splitMarks(next).body.length;
    setFull(next);
  };
  const { submit, sendBuild, sendLater } = useSubmit({
    text: full, setText: setFull, shell: ac.shell, uploading, uses, setUses, clear: () => { wantCaret.current = 0; setFull(''); },
    sentHistory: h.sentHistory, setSentHistory: h.setSentHistory, clearHistoryStep: () => h.setHist(null),
  });

  const [talked, setTalked] = useState(0);
  const [talking, setTalking] = useState(false);
  const [dictating, setDictating] = useState(false);
  useEffect(() => { if (talked) submit(false, true); }, [talked]);
  const [quick, setQuick] = useState(0);
  useEffect(() => { if (quick) submit(); }, [quick]);
  const reply = (t: string) => { applyFull(t); setQuick((n) => n + 1); };

  useComposerEvents({ ta, wantCaret, setText, setUses, sendBuild, setPick, root, canEffort });

  const { choose, onKeyDown } = useComposerKeys({ text, full, mode, modes, ghost, ac, h, apply, applyFull, submit });

  return (
    <div ref={root} className="cp" data-mode={mode}>
      {shared !== null && <SharedConfirm shared={shared} setShared={setShared} setText={setText} />}
      {asked && !running && !waiting && !typed && (
        <div className="cp-quick" role="group" aria-label="Quick replies">
          {QUICK_REPLIES.map((t) => <Chip key={t} size="sm" onClick={() => reply(t)}>{t}</Chip>)}
        </div>
      )}
      <div
        ref={ac.card}
        className={`cp-card${ac.shell ? ' shell' : ''}${narrow ? ' pill' : ''}${narrow && multi ? ' multi' : ''}`}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach([...e.dataTransfer.files]); } }}
      >
        <UsesBar uses={uses} remove={(u) => setUses((l) => l.filter((x) => x !== u))} />
        <AttachmentsBar marks={marks} remove={(i) => setMarks((l) => l.filter((_, j) => j !== i))} />
        <div className={narrow ? 'cp-row' : undefined}>
        {narrow && <AddMenu uploading={uploading} setPick={setPick} attach={attach} laterable={typed && !ac.shell} sendLater={sendLater} />}
        <div className="cp-text">
          <div ref={mirror} className="cp-mirror" aria-hidden><span className="cp-typed">{text}</span><span className="cp-ghost">{ghost}</span>{ghost && !touch() && <kbd className="cp-key">Tab</kbd>}</div>
          <textarea
            ref={ta}
            value={text}
            rows={1}
            aria-label={`Message ${label}`}
            aria-autocomplete="list"
            aria-controls={ac.open ? popId : undefined}
            aria-activedescendant={ac.open ? `${popId}-${ac.sel}` : undefined}
            placeholder={placeholderFor(label, running, waiting, compacting, uses.length > 0, narrow)}
            spellCheck={!ac.shell}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            enterKeyHint={touch() ? 'enter' : undefined}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach([...e.clipboardData.files]); } }}
          />
        </div>
        {narrow && (
          <>
            {(!typed || dictating) && <Voice onText={dictate} onListen={setDictating} />}
            {!talking && (typed || running || !recognizer()) ? <SendButton typed={typed} shell={ac.shell} submit={submit} /> : <Voice onText={dictate} onSubmit={() => setTalked((n) => n + 1)} onListen={setTalking} />}
          </>
        )}
        </div>
        {ghost && touch() && (
          <button className="cp-suggest" title="Use this suggestion" onPointerDown={(e) => e.preventDefault()} onClick={() => apply(text + ghost)}>
            <Icon name="arrow-right" small /><span>{text.length > 12 && '…'}{text.slice(-12)}<b>{ghost}</b></span>
          </button>
        )}
        {!narrow && <ComposerFoot uses={uses} uploading={uploading} typed={typed} shell={ac.shell} setPick={setPick} attach={attach} dictate={dictate} submit={submit} sendLater={sendLater} />}
      </div>
      <ComposerStats hint={ac.shell ? 'Runs in the terminal' : ''} />
      {ac.open && (
        <ul ref={ac.pop} id={popId} className="cp-pop" role="listbox" aria-label={ac.trigger?.kind === 'command' ? 'Commands' : 'Files'}>
          <PopItems items={ac.items} kind={ac.trigger?.kind} popId={popId} sel={ac.sel} choose={choose} />
        </ul>
      )}
      <Announcer key={chat} />
      <ChatSettings pick={pick} setPick={setPick} savedCount={h.sentHistory.length} />
      <PickerSheets pick={pick} setPick={setPick} sentHistory={h.sentHistory} setUses={setUses} apply={apply} focus={() => ta.current?.focus()} />
    </div>
  );
});
