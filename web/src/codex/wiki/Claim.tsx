import { memo, useState } from 'react';
import { useAssistantStore } from '../data';
import { chatOf, contestOf, sourcesOf, type Fact } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { ago } from '../../ui/util';
import { showSnack } from '../view';
import { ClaudeChip, SourceChip } from './Chips';
import { useReview } from './Review';
import { shortDate } from './shared';

export const Claim = memo(function Claim({ fact, old, page, flash }: { fact: Fact; old: Fact[]; page: string; flash: boolean }) {
  const store = useAssistantStore();
  const review = useReview();
  const proposed = fact.state === 'proposed';
  const [contesting, setContesting] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const c = contestOf(fact);
  const startEdit = () => { setDraft(fact.text ?? ''); setEditing(true); };
  const save = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === fact.text) return;
    const prev = fact.text;
    void store.editRow('facts', fact, { text: next });
    showSnack('Claim updated', () => void store.editRow('facts', fact, { text: prev }));
  };
  const contest = () => {
    void store.editRow('facts', fact, { contested: JSON.stringify({ by: 'you', at: Date.now(), note: note.trim() }) });
    setContesting(false);
    setNote('');
    showSnack('Claim contested', () => void store.editRow('facts', fact, { contested: null }));
  };
  const resolve = () => {
    void store.editRow('facts', fact, { contested: null });
    showSnack('Marked as resolved', () => void store.editRow('facts', fact, { contested: fact.contested }));
  };
  const cite = () => {
    const srcs = sourcesOf(fact).map((s) => s.label);
    const text = `${page}: ${fact.text}${srcs.length ? ` (${srcs.join(', ')}${fact.at ? `, ${shortDate(fact.at)}` : ''})` : ''}`;
    navigator.clipboard?.writeText(text).then(() => showSnack('Claim copied'), () => showSnack('Could not copy'));
  };
  return (
    <li className={`wk-claim${c ? ' contested' : ''}${proposed ? ' proposed' : ''}${flash ? ' flash' : ''}`} id={`claim-${fact.id}`}>
      {editing ? (
        <div className="wk-contest-form">
          <textarea autoFocus rows={2} value={draft} aria-label="Claim" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
          <div className="wk-contest-btns">
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </div>
      ) : <span className="wk-claim-text">{fact.text}</span>}
      <span className="wk-claim-foot">
        {sourcesOf(fact).map((s, i) => <SourceChip key={i} s={s} />)}
        {chatOf(fact) && <ClaudeChip chat={chatOf(fact)!} />}
        {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
        <span className="spacer" />
        <span className="wk-claim-acts">
          {proposed ? (
            <>
              <span className="wk-proposed">Proposed</span>
              <button className="icon-btn mt-reject" title="Reject" aria-label="Reject" onClick={() => review.reject([fact])}><Icon name="close" small /></button>
              <button className="icon-btn" title="Approve" aria-label="Approve" onClick={() => review.approve([fact])}><Icon name="check" small /></button>
            </>
          ) : (
            <>
              {!editing && <button className="icon-btn" title="Edit the claim text" aria-label="Edit the claim text" onClick={startEdit}><Icon name="edit" small /></button>}
              <button className="icon-btn" title="Copy as a citation" aria-label="Copy as a citation" onClick={cite}><Icon name="link" small /></button>
              {fact.state === 'retired'
                ? <button className="wk-act" title="Show this claim with the current ones again" onClick={() => { void store.editRow('facts', fact, { state: null }); showSnack('Claim restored', () => void store.editRow('facts', fact, { state: 'retired' })); }}><Icon name="history" small /> Restore</button>
                : <button className="wk-act" title="Move this claim to Older; Claude stops using it" onClick={() => { void store.editRow('facts', fact, { state: 'retired' }); showSnack('Claim retired', () => void store.editRow('facts', fact, { state: null })); }}><Icon name="archive" small /> Retire</button>}
            </>
          )}
          {!proposed && !c && !contesting && <button className="wk-act" title="Say this claim is wrong or out of date" onClick={() => setContesting(true)}><Icon name="report" small /> Contest</button>}
        </span>
      </span>
      {contesting && (
        <div className="wk-contest-form">
          <textarea autoFocus rows={2} value={note} aria-label="Why this claim is wrong" placeholder="What is wrong or out of date? Link a source if you have one." onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setContesting(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) contest(); }} />
          <div className="wk-contest-btns">
            <button className="btn" onClick={() => setContesting(false)}>Cancel</button>
            <button className="btn primary" onClick={contest}>Contest</button>
          </div>
        </div>
      )}
      {c && (
        <div className="wk-contest">
          <div className="wk-contest-head">
            <Icon name="warning" small /> Contested by {c.by} · {ago(c.at, ' ago')}
            <span className="spacer" />
            <button className="wk-act" title="The claim is right, or the agent has replaced it" onClick={resolve}><Icon name="check" small /> Resolve</button>
          </div>
          {c.note && <div className="wk-contest-note">{c.note}</div>}
        </div>
      )}
      {old.map((o) => (
        <div key={o.id} className="wk-old">
          <s>{o.text}</s>
          <span>Replaced {o.at != null ? shortDate(o.at) : ''}</span>
        </div>
      ))}
    </li>
  );
});
