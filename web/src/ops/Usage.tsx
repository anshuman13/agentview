import type { UsageAccount } from '../../../shared/protocol';
import { EmptyState, Panel } from '../ui/Panel';
import { Loading } from '../ui/Skeleton';
import { useLoad } from '../ui/useLoad';
import { dayBars, limitRows, seriesLines, TOKEN_KINDS, TOKEN_LABEL, tokens, tokenTotals, type Point } from './usageLogic';
import { fetchUsage } from './usageApi';
import '../styles/features/usage.css';

const path = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * 100).toFixed(2)},${(100 - Math.min(100, p.y)).toFixed(2)}`).join('');

function Limits({ a, now }: { a: UsageAccount; now: number }) {
  const rows = limitRows(a.latest, now);
  if (!rows.length) return <div className="usage-none">No limits sampled yet</div>;
  return (
    <div className="usage-limits">
      {rows.map((r) => (
        <div key={r.label} className="usage-limit">
          <span className="usage-limit-label">{r.label}</span>
          <span className="usage-meter" role="meter" aria-label={r.label} aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100}>
            <span className={r.pct >= 90 ? 'high' : ''} style={{ width: `${Math.min(100, r.pct)}%` }} />
          </span>
          <span className="usage-limit-pct">{r.pct}%</span>
          <span className="usage-limit-text">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

function Lines({ a, now }: { a: UsageAccount; now: number }) {
  const { fiveHour, week } = seriesLines(a.series, now);
  if (!fiveHour.length && !week.length) return null;
  return (
    <figure className="usage-chart">
      <figcaption>Last 7 days<span className="usage-key five">5-hour</span><span className="usage-key week">Weekly</span></figcaption>
      <svg className="usage-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="5-hour and weekly use over the last 7 days">
        {[25, 50, 75].map((y) => <line key={y} className="grid" x1="0" x2="100" y1={y} y2={y} />)}
        <path className="five" d={path(fiveHour)} />
        <path className="week" d={path(week)} />
      </svg>
    </figure>
  );
}

function Bars({ a }: { a: UsageAccount }) {
  const bars = dayBars(a.days);
  const totals = tokenTotals(a.days);
  const w = 100 / Math.max(1, bars.length);
  return (
    <figure className="usage-chart">
      <figcaption>Tokens per day, last {a.days.length} days</figcaption>
      <svg className="usage-bars" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Tokens per day">
        {bars.map((b, i) => {
          let y = 100;
          return (
            <g key={b.day}>
              <title>{`${b.day}: ${tokens(b.total)}`}</title>
              {b.parts.map((p, k) => {
                const h = p * 100;
                y -= h;
                return h > 0 && <rect key={k} className={TOKEN_KINDS[k]} x={i * w + w * 0.15} width={w * 0.7} y={y} height={h} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="usage-axis">
        <span>{bars[0]?.label}</span>
        <span>{bars.at(-1)?.label}</span>
      </div>
      <ul className="usage-legend">
        {TOKEN_KINDS.map((k) => (
          <li key={k}><span className={`usage-swatch ${k}`} />{TOKEN_LABEL[k]}<span className="usage-total">{tokens(totals[k])}</span></li>
        ))}
      </ul>
    </figure>
  );
}

export function Usage() {
  const [load] = useLoad(() => fetchUsage(30), 'usage');
  if (load.busy) return <Loading />;
  if (load.error) return <EmptyState icon="graph" title="Usage could not be loaded" hint={load.error} />;
  const accounts = load.data?.accounts ?? [];
  if (!accounts.length) return <EmptyState icon="graph" title="No Claude accounts are logged in" />;
  const now = Date.now();
  return (
    <div className="usage">
      {accounts.map((a) => (
        <Panel key={a.account} title={a.name} className="usage-card">
          <Limits a={a} now={now} />
          <Lines a={a} now={now} />
          <Bars a={a} />
        </Panel>
      ))}
    </div>
  );
}
