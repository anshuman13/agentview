import { Row } from '../ui/Row';
import { money } from '../ui/util';
import { billing } from '../../../shared/providers';
import type { Provider } from '../../../shared/protocol';
import { roundGroupText, type mergeQuiet } from '../../../shared/goalText';
import { OUTCOME_DOT } from '../chat/composer/composerLogic';

type Group = ReturnType<typeof mergeQuiet>[number];

// One round, or a run of quiet rounds, of a loop or goal; a round with a report opens it.
export function RoundRow({ group: g, provider, open }: { group: Group; provider?: Provider; open: (report: string) => void }) {
  const report = g.last.report;
  return <Row plain={!report} leading={<span className={`dot ${OUTCOME_DOT[g.last.outcome]}`} />} title={roundGroupText(g)} meta={money(g.costUsd, billing(provider))} onClick={report ? () => open(report) : undefined} />;
}
