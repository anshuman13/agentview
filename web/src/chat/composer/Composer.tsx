import { useId, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { touch } from '../../app/touch/touch';
import { useNarrow } from '../../app/shell/useNarrow';
import { LoopCard } from '../cards/LoopCard';
import { TodoCard } from '../cards/TodoCard';
import { useDictation, Voice } from './Voice';
import { AddMenu } from './AddMenu';
import { PopItems } from './ComposerPop';
import { Announcer } from '../Announcer';
import { ChatSettings, useChatSettings, type Pick } from '../ChatSettings';
import { ghostFor, type Use } from './composerLogic';
import { ComposerFoot, SendButton } from './ComposerFoot';
import { ComposerStats } from './ComposerStats';
import { PickerSheets } from './PickerSheets';
import { SharedConfirm, useSharedIntake } from './SharedText';
import { UsesBar } from './UsesBar';
import { useAutocomplete } from './useAutocomplete';
import { useAutoHeight } from './useAutoHeight';
import { useBarHidden } from './useBarHidden';
import { useComposerEvents } from './useComposerEvents';
import { useComposerKeys } from './useComposerKeys';
import { useDraft, usePromptHistory } from './usePromptHistory';
import { useSubmit } from './useSubmit';
import { useUploads } from './useUploads';
import { providerLabel } from '../../../../shared/providers';

function placeholderFor(label: string, running: boolean, waiting: boolean, compacting: boolean, hasUses: boolean) {
  if (waiting) return `Answer below, or message ${label} to stop and send`;
  if (compacting) return 'Sends when compacting is done';
  if (running) return touch() ? `${label} reads this next · hold Send to stop` : `${label} reads this at its next step · ⌘Enter stops and sends`;
  return hasUses ? `What should ${label} do with it?` : 'Ask anything · / commands · @ files · @chat: chats';
}

export function Composer() {
  const chat = useStore((s) => s.session.id);
  const running = useStore((s) => s.session.running);
  const label = useStore((s) => providerLabel(s.session.provider));
  const compacting = useStore((s) => s.session.compacting);
  const waiting = useStore((s) => s.pending.length > 0);
  const { mode, modes } = useChatSettings();
  const [pick, setPick] = useState<Pick | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const narrow = useNarrow();
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

  const ghost = !ac.open && !ac.shell && ac.at === text.length ? ghostFor(text, h.history) : '';
  const typed = text.trim().length > 0;
  const multi = useAutoHeight(ta, mirror, wantCaret, setCaret, [text, ghost]);
  useBarHidden(ta, typed);

  const apply = (next: string, c = next.length) => {
    wantCaret.current = c;
    setText(next);
  };
  const { submit, sendBuild } = useSubmit({
    text, setText, shell: ac.shell, uploading, uses, setUses, apply,
    sentHistory: h.sentHistory, setSentHistory: h.setSentHistory, clearHistoryStep: () => h.setHist(null),
  });

  useComposerEvents({ ta, wantCaret, setText, setUses, sendBuild });

  const { choose, onKeyDown } = useComposerKeys({ text, mode, modes, ghost, ac, h, apply, submit });

  return (
    <div className="cp" data-mode={mode}>
      {shared !== null && <SharedConfirm shared={shared} setShared={setShared} setText={setText} />}
      <TodoCard />
      <LoopCard />
      <div
        ref={ac.card}
        className={`cp-card${ac.shell ? ' shell' : ''}${narrow ? ' pill' : ''}${narrow && multi ? ' multi' : ''}`}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach([...e.dataTransfer.files]); } }}
      >
        <UsesBar uses={uses} remove={(u) => setUses((l) => l.filter((x) => x !== u))} />
        <div className={narrow ? 'cp-row' : undefined}>
        {narrow && <AddMenu uploading={uploading} setPick={setPick} attach={attach} />}
        <div className="cp-text">
          <div ref={mirror} className="cp-mirror" aria-hidden><span className="cp-typed">{text}</span><span className="cp-ghost">{ghost}</span></div>
          <textarea
            ref={ta}
            value={text}
            rows={1}
            aria-label={`Message ${label}`}
            aria-autocomplete="list"
            aria-controls={ac.open ? popId : undefined}
            aria-activedescendant={ac.open ? `${popId}-${ac.sel}` : undefined}
            placeholder={placeholderFor(label, running, waiting, compacting, uses.length > 0)}
            spellCheck={!ac.shell}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            enterKeyHint={touch() ? 'enter' : undefined}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach([...e.clipboardData.files]); } }}
          />
        </div>
        {narrow && (typed || running ? <SendButton typed={typed} shell={ac.shell} submit={submit} /> : <Voice onText={dictate} />)}
        </div>
        {ghost && touch() && (
          <button className="cp-suggest" title="Use this suggestion" onPointerDown={(e) => e.preventDefault()} onClick={() => apply(text + ghost)}>
            <Icon name="arrow-right" small /><span>{text.length > 12 && '…'}{text.slice(-12)}<b>{ghost}</b></span>
          </button>
        )}
        {!narrow && <ComposerFoot uses={uses} uploading={uploading} typed={typed} shell={ac.shell} setPick={setPick} attach={attach} dictate={dictate} submit={submit} />}
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
}
