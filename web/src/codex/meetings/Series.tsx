import { useMemo } from 'react';
import { useAssistantData } from '../data';
import { dayLabel } from '../data/dates';
import { seriesRepeats } from '../data/meetings';
import type { ItemRow } from '../data/sync';
import { listOf, type Meeting } from '../data/wiki';
import { openMeeting } from '../view';

export function Series({ m, prior }: { m: Meeting; prior: Meeting[] }) {
  const snap = useAssistantData();
  const undone = useMemo(() => {
    const open = new Map(prior.map((x) => [x.profile + x.id, [] as ItemRow[]]));
    for (const r of snap.items) if (!r.deleted && r.status === 'open' && r.meeting_id) open.get(r.profile + r.meeting_id)?.push(r);
    return prior.flatMap((x) => open.get(x.profile + x.id)!.map((r) => ({ x, r })));
  }, [prior, snap.items]);
  if (!prior.length) return null;
  const repeats = seriesRepeats(m, prior[0]);
  const date = (x: Meeting) => dayLabel(x.starts_at!);
  const decisions = prior.slice(0, 3).flatMap((x) => listOf(x.decisions).map((t) => t.trim()).filter(Boolean).map((text) => ({ x, text })));
  return (
    <section className="mt-sec">
      <h2>Series</h2>
      <p className="mt-series">{prior.length} earlier, last on {date(prior[0])}</p>
      {repeats.decisions.length + repeats.questions.length > 0 && <div className="mt-series-list">
        {repeats.decisions.map((text, i) => <button key={`d${i}`} className="mt-log-item" onClick={() => openMeeting(prior[0])}><span className="mt-log-text">{text}</span><span className="mt-log-from">Decided again, also on {date(prior[0])}</span></button>)}
        {repeats.questions.map((text, i) => <button key={`q${i}`} className="mt-log-item" onClick={() => openMeeting(prior[0])}><span className="mt-log-text">{text}</span><span className="mt-log-from">Asked again, also on {date(prior[0])}</span></button>)}
      </div>}
      {decisions.length > 0 && <div className="mt-series-list">{decisions.map(({ x, text }, i) => (
        <button key={i} className="mt-log-item" onClick={() => openMeeting(x)}><span className="mt-log-text">{text}</span><span className="mt-log-from">Decided {date(x)}</span></button>
      ))}</div>}
      {undone.length > 0 && <div className="mt-series-list">{undone.map(({ x, r }) => (
        <button key={r.profile + r.id} className="mt-log-item" onClick={() => openMeeting(x)}><span className="mt-log-text">{r.title || r.text}</span><span className="mt-log-from">Still open from {date(x)}</span></button>
      ))}</div>}
    </section>
  );
}
