import { useEffect, useState } from 'react';
import { dayKey, dayNumber, featureRows, type Feature, type FeatureKind, type UsedFeature, type UseDays } from '../../../../shared/featureUse';
import { errText } from '../../../../shared/util';
import { Button, Chip } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { fetchFeatureUse } from '../featureUseApi';

const KIND: Record<FeatureKind, string> = { page: 'Page', tab: 'Tab', list: 'List', palette: 'Palette', sheet: 'Sheet', action: 'Action' };
const SHOWN = 5;

const lastUsed = (day: string, today: string) => (day === today ? 'today' : `${dayNumber(today) - dayNumber(day)}d ago`);

function FeatureSection<T extends Feature>({ label, rows, meta }: { label: string; rows: T[]; meta: (r: T) => string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <Section label={label} count={rows.length} />
      <div className="ui-group">
        {shown.map((r) => <Row key={r.id} plain title={r.label} meta={meta(r)} />)}
      </div>
      {shown.length < rows.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => setAll(true)}>Show all {rows.length}</Button>}
    </>
  );
}

// Every feature the Mac has counted, split into never used and used, for the last 7 or 30 days.
export function FeatureUseSheet({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<UseDays>();
  const [error, setError] = useState('');
  const [span, setSpan] = useState<7 | 30>(30);
  useEffect(() => {
    fetchFeatureUse().then((r) => setDays(r.days), (err) => setError(errText(err)));
  }, []);
  const today = dayKey(new Date());
  const rows = days && featureRows(days, today, span);
  const usedMeta = (f: UsedFeature) => {
    const n = span === 7 ? f.n7 : f.n30;
    return `${KIND[f.kind]} · ${n} ${n === 1 ? 'time' : 'times'} · ${lastUsed(f.last, today)}`;
  };
  return (
    <Sheet label="Feature use" onClose={onClose} className="as-dialog">
      <div className="ui-group">
        <div className="ui-fields">
          <div className="gl-chips">{([7, 30] as const).map((n) => <Chip key={n} on={span === n} onClick={() => setSpan(n)}>{n} days</Chip>)}</div>
        </div>
      </div>
      {error && <EmptyState size="sm" title="Could not load feature use" hint={error} />}
      {rows && (
        <>
          <FeatureSection label="Never used" rows={rows.never} meta={(f) => KIND[f.kind]} />
          <FeatureSection label="Used" rows={rows.used} meta={usedMeta} />
        </>
      )}
    </Sheet>
  );
}
