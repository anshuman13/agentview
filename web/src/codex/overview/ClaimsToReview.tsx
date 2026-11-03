import { useCodex } from '../data';
import { proposals } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { setView } from '../view';

export function ClaimsToReview() {
  const { facts } = useCodex();
  const n = proposals(facts).length;
  if (!n) return null;
  return (
    <section className="ov-follow">
      <div className="ov-follow-row">
        <button className="ov-follow-text" onClick={() => setView({ list: 'wiki', open: 'review', anchor: null, person: null })}>
          <span className="ov-t"><Icon name="check" small /> {n} wiki {n === 1 ? 'claim waits' : 'claims wait'} for you</span>
          <span className="muted small">Approve or reject them one at a time</span>
        </button>
      </div>
    </section>
  );
}
