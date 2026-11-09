import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantTable, useCodex } from '../data';
import { ask, wikiAskText } from '../data/ask/ask';
import { olderClaims, pageClaims, staleClaims, proposals } from '../data/wiki/wiki';
import { mentionsOf, type Mentions } from '../data/meetings/mentions';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { EmptyState } from '../../ui/Panel';
import { ShowMore, capGroups, useWindow } from '../../ui/useWindow';
import { setView, useEscapeBack, useView } from '../view';
import { AskBar } from './AskBar';
import { usePageEdits } from './usePageEdits';
import { useClaimAnchor } from './useClaimAnchor';
import { WikiPageHead } from './WikiPageHead';
import { ClaimGroups, OlderClaims, PendingBanner, ProposeForm } from './WikiPageParts';
import { PageTile } from './PageTile';
import { useReview } from './Review';
import { MEMORY, memoryPage } from './shared';

export function WikiPage({ id }: { id: string }) {
  const { pages, facts, meetings } = useCodex();
  const items = useAssistantTable('items');
  const { filter } = useView();
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [proposing, setProposing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const pid = id === MEMORY ? null : id;
  const page = id === MEMORY ? memoryPage(facts) : pages.find((p) => p.id === id && !p.deleted && p.state !== 'rejected');
  const review = useReview();
  const groups = useMemo(() => pageClaims(facts, pid), [facts, pid]);
  const older = useMemo(() => olderClaims(facts, pid), [facts, pid]);
  const stale = useMemo(() => new Set(staleClaims(facts, pid).map((f) => f.id)), [facts, pid]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.claims.length, 0), [groups]);
  const { showAll, showOlder, setShowOlder, flash } = useClaimAnchor(id, older, facts.length > 0);
  const [shown, more] = useWindow(String(pid));
  const visible = useMemo(() => capGroups(groups, showAll ? Infinity : shown, 'claims'), [groups, shown, showAll]);
  const mentions = useMemo(() => {
    const out = new Map<string, Mentions>();
    if (pid && page?.title) for (const g of visible) for (const { fact } of g.claims) if (fact.state !== 'proposed') out.set(fact.profile + fact.id, mentionsOf({ items, meetings }, fact, page.title));
    return out;
  }, [visible, items, meetings, pid, page?.title]);
  // After Approve all or Reject all the banner stays as a note, so the claims below do not jump up under the finger.
  const [decided, setDecided] = useState<string | null>(null);
  useEffect(() => { setDecided(null); setMenu(false); setAsking(false); setProposing(null); setRenaming(null); }, [id]);
  const pending = useMemo(() => proposals(facts).filter((f) => (f.page_id ?? null) === pid), [facts, pid]);
  const back = () => setView({ open: null, anchor: null });
  useEscapeBack(back);
  const edits = usePageEdits(page, pid, filter, back);
  const propose = () => {
    const text = proposing?.trim();
    setProposing(null);
    edits.propose(text);
  };
  const rename = () => {
    const title = renaming?.trim();
    setRenaming(null);
    edits.rename(title);
  };
  return (
    <div className="wk">
      <header className="wk-head">
        <button className="icon-btn" title="Back to the wiki" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        {page && (
          <WikiPageHead page={page} isMemory={!pid} groups={groups} pending={pending} renaming={renaming} setRenaming={setRenaming} cancelled={edits.cancelled} onRename={rename} onPropose={() => setProposing((v) => v ?? '')}
            menu={menu} setMenu={setMenu} moreBtn={moreBtn} onAsk={() => setAsking(true)} onArchive={edits.archive} />
        )}
      </header>
      <div className="wk-scroll">
        {!page ? (
          <EmptyState size="sm" icon="book" title="This page is gone" action={<Button size="sm" onClick={back}>Back to the wiki</Button>} />
        ) : (
          <div className="wk-doc">
            <article className="wk-article">
              {proposing !== null && <ProposeForm value={proposing} setValue={setProposing} save={propose} />}
              {pid && <PageTile page={page} />}
              {page.summary && <p className="wk-lede">{page.summary}</p>}
              <PendingBanner pending={pending} page={page} decided={decided} setDecided={setDecided} review={review} setConfirm={setConfirm} />
              <ClaimGroups groups={visible} page={page.title ?? ''} flash={flash} mentions={mentions} review={review} />
              <ShowMore shown={shown} total={total} onMore={more} />
              <OlderClaims older={older} stale={stale} open={showOlder} toggle={() => setShowOlder((v) => !v)} page={page.title ?? ''} flash={flash} />
              {!groups.length && !older.length && <EmptyState size="sm" icon="book" title="No claims yet" hint={`They appear here as meetings, Slack threads and issues mention ${page.title}`} />}
            </article>
          </div>
        )}
      </div>
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
      {asking && page && (
        <Sheet label="Ask" onClose={() => { setAsking(false); moreBtn.current?.focus(); }}>
          <AskBar placeholder={`Ask about ${page.title}`} onAsk={(q) => { const ok = ask(wikiAskText(q, pages, facts, id), page.profile); if (ok) setAsking(false); return ok; }} />
        </Sheet>
      )}
    </div>
  );
}
