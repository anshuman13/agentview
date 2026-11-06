import { useEffect, useMemo, useRef, useState } from 'react';
import { useCodex } from '../data';
import { chatOf, proposals, sourcesOf, type Fact } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { setView, useEscapeBack } from '../view';
import { Swipe } from '../Swipe';
import { ClaudeChip, SourceChip } from './Chips';
import { useReview } from './Review';
import { MEMORY, shortDate } from './shared';

const key = (f: Fact) => f.profile + f.id;

// One proposed claim at a time with big Approve, Skip and Reject, so a long list can be cleared with the thumb.
// The order is fixed when the screen opens; a skipped claim goes to the back, a decided one stays counted.
export function ReviewMode() {
  const { pages, facts } = useCodex();
  const review = useReview();
  const order = useRef<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const open = useMemo(() => new Map(proposals(facts).map((f) => [key(f), f])), [facts]);
  for (const k of open.keys()) if (!order.current.includes(k)) order.current.push(k);
  const total = order.current.length;
  const left = order.current.filter((k) => open.has(k));
  const queue = [...left.filter((k) => !skipped.includes(k)), ...skipped.filter((k) => open.has(k))];
  const fact = queue.length ? open.get(queue[0]) : undefined;
  const n = total - left.length + 1;
  const back = () => setView({ open: null, anchor: null });
  useEscapeBack(back);
  useEffect(() => { if (!fact && skipped.length) setSkipped([]); }, [fact, skipped.length]);
  const page = fact?.page_id ? pages.find((p) => p.id === fact.page_id && p.profile === fact.profile) : undefined;
  const old = fact?.replaces ? facts.find((f) => f.id === fact.replaces && f.profile === fact.profile) : undefined;
  const skip = () => fact && setSkipped((s) => [...s.filter((k) => k !== key(fact)), key(fact)]);
  return (
    <div className="wk wk-mode">
      <header className="wk-head">
        <button className="icon-btn" title="Back to the wiki" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <h1>Review claims</h1>
        <span className="spacer" />
        {fact && <span className="wk-mode-n" aria-live="polite">{n} of {total}</span>}
      </header>
      <div className="wk-scroll">
        {!fact ? (
          <EmptyState size="sm" icon="check" title={total ? 'All claims reviewed.' : 'Nothing waits for review.'} action={<Button size="sm" onClick={back}>Back to the wiki</Button>} />
        ) : (
          <Swipe onRight={() => review.approve([fact])} onLeft={() => review.reject([fact])} rightLabel="Approve" leftLabel="Reject" leftIcon="close">
            <article className="wk-mode-card" key={key(fact)}>
              <div className="mt-action-kind">
                <Icon name={page ? 'book' : 'lightbulb'} small />
                <button className="wk-review-open" onClick={() => setView({ open: fact.page_id ?? MEMORY, anchor: fact.id })}>
                  {page ? <>{page.title}{page.state === 'proposed' && <em> (new page)</em>}{fact.heading && <> · {fact.heading}</>}</> : 'Memory'} <Icon name="chevron-right" small />
                </button>
              </div>
              <p className="wk-mode-text">{fact.text}</p>
              {old && <div className="wk-old"><s>{old.text}</s><span>Replaces</span></div>}
              <div className="wk-claim-foot">
                {sourcesOf(fact).map((s, i) => <SourceChip key={i} s={s} />)}
                {chatOf(fact) && <ClaudeChip chat={chatOf(fact)!} />}
                {fact.at != null && <span className="wk-claim-date">{shortDate(fact.at)}</span>}
              </div>
            </article>
          </Swipe>
        )}
      </div>
      {fact && (
        <div className="wk-mode-acts">
          <button className="btn mt-reject" onClick={() => review.reject([fact])}><Icon name="close" small /> Reject</button>
          <button className="btn" onClick={skip}>Skip</button>
          <button className="btn primary" onClick={() => review.approve([fact])}><Icon name="check" small /> Approve</button>
        </div>
      )}
    </div>
  );
}
