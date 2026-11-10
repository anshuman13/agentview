import { useEffect, useState, type ReactNode } from 'react';
import { dayKey, dayNumber, featureRows, type Feature, type FeatureKind, type UsedFeature, type UseDays } from '../../../../shared/featureUse';
import { errText } from '../../../../shared/util';
import { SnackBar } from '../../codex/tasks/SnackBar';
import { showSnack } from '../../codex/view';
import { Button, Chip } from '../../ui/Button';
import { MenuItem } from '../../ui/Menu';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { appSettings } from '../appSettings';
import { fetchFeatureUse, saveHiddenFeatures } from '../featureUseApi';

const KIND: Record<FeatureKind, string> = { page: 'Page', tab: 'Tab', list: 'List', palette: 'Palette', sheet: 'Sheet', more: 'More', action: 'Action' };
const SHOWN = 5;

const lastUsed = (day: string, today: string) => (day === today ? 'today' : `${dayNumber(today) - dayNumber(day)}d ago`);

function FeatureSection<T extends Feature>({ label, rows, meta, menu }: { label: string; rows: T[]; meta: (r: T) => string; menu: (r: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <Section label={label} count={rows.length} />
      <div className="ui-group">
        {shown.map((r) => <Row key={r.id} plain title={r.label} meta={meta(r)} menu={menu(r)} />)}
      </div>
      {shown.length < rows.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => setAll(true)}>Show all {rows.length}</Button>}
    </>
  );
}

const SAVE_FAILED = 'Could not save. Nothing changed, try again.';

// Every feature the Mac has counted, split into never used and used, for the last 7 or 30 days. Hidden features are listed apart.
export function FeatureUseSheet({ onClose }: { onClose: () => void }) {
  const on = appSettings.use((s) => s.featureUse);
  const hidden = appSettings.use((s) => s.hiddenFeatures);
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
  const save = (next: string[], text: string, back: string[]) => saveHiddenFeatures(next).then(
    (r) => { appSettings.patch({ hiddenFeatures: r.hiddenFeatures ?? [] }); showSnack(text, () => void save(back, 'Undone', next)); },
    () => showSnack(SAVE_FAILED),
  );
  const menu = (f: Feature) => {
    if (!f.hideable) return null;
    const isHidden = hidden.includes(f.id);
    return <MenuItem icon={isHidden ? 'eye' : 'eye-closed'} onClick={() => void save(isHidden ? hidden.filter((id) => id !== f.id) : [...hidden, f.id], `${f.label} ${isHidden ? 'shown' : 'hidden'}`, hidden)}>{isHidden ? 'Show' : 'Hide'}</MenuItem>;
  };
  const shown = (r: Feature) => !hidden.includes(r.id);
  const hiddenRows = rows ? [...rows.used, ...rows.never].filter((f) => !shown(f)) : [];
  return (
    <Sheet label="Feature use" onClose={onClose} className="as-dialog">
      {on && (
        <div className="ui-group">
          <div className="ui-fields">
            <div className="gl-chips">{([7, 30] as const).map((n) => <Chip key={n} on={span === n} onClick={() => setSpan(n)}>{n} days</Chip>)}</div>
          </div>
        </div>
      )}
      {error && <EmptyState size="sm" title="Could not load feature use" hint={error} />}
      {rows && (
        <>
          {on && <FeatureSection label="Never used" rows={rows.never.filter(shown)} meta={(f) => KIND[f.kind]} menu={menu} />}
          {on && <FeatureSection label="Used" rows={rows.used.filter(shown)} meta={usedMeta} menu={menu} />}
          {hiddenRows.length > 0 && <FeatureSection label="Hidden" rows={hiddenRows} meta={(f) => ('last' in f ? usedMeta(f as UsedFeature) : KIND[f.kind])} menu={menu} />}
        </>
      )}
      <SnackBar />
    </Sheet>
  );
}
