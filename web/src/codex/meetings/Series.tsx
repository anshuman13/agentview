import { useMemo } from 'react';
import { useAssistantData } from '../data';
import { dayLabel } from '../data/dates';
import { seriesRepeats } from '../data/meetings';
import type { ItemRow } from '../data/sync';
import { listOf, type Meeting } from '../data/wiki';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
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
      <Section label="Series" count={sectionCount(repeats.decisions.length + repeats.questions.length)} />
      <p className="mt-series">{prior.length} earlier, last on {date(prior[0])}</p>
      {repeats.decisions.length + repeats.questions.length > 0 && <div className="as-group">
        {repeats.decisions.map((text, i) => <Row key={`d${i}`} lines={2} title={text} meta={`Decided again, also on ${date(prior[0])}`} onClick={() => openMeeting(prior[0])} />)}
        {repeats.questions.map((text, i) => <Row key={`q${i}`} lines={2} title={text} meta={`Asked again, also on ${date(prior[0])}`} onClick={() => openMeeting(prior[0])} />)}
      </div>}
      {decisions.length > 0 && <div className="as-group">{decisions.map(({ x, text }, i) => (
        <Row key={i} lines={2} title={text} meta={`Decided ${date(x)}`} onClick={() => openMeeting(x)} />
      ))}</div>}
      {undone.length > 0 && <div className="as-group">{undone.map(({ x, r }) => (
        <Row key={r.profile + r.id} lines={2} title={r.title || r.text} meta={`Still open from ${date(x)}`} onClick={() => openMeeting(x)} />
      ))}</div>}
    </section>
  );
}
