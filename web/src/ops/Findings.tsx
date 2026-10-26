import { useEffect, type ReactNode } from 'react';
import { api, send, setFindings, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { pressable } from '../ui/util';
import type { Finding, ReviewFindings } from '../../../shared/protocol';

async function call<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(api(path), body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
  if (!r.ok || data?.error) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data;
}

export function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <>
      <div className="gh-block">{title}{count !== undefined && <span className="badge quiet">{count}</span>}</div>
      {children}
    </>
  );
}

// Review Claude's code review findings for a pull request number or "local" for the working tree.
export const REVIEW_LOCAL = '/code-review';

const findingKey = (f: Finding) => `${f.file}:${f.line}:${f.summary.slice(0, 60)}`;

// What /code-review reported, most severe first; a row opens the file on its line.
export function Findings({ target }: { target: string }) {
  const review = useStore((s) => s.findings[target]);
  useEffect(() => {
    call<ReviewFindings | null>(`/api/findings?target=${target}`).then(setFindings, () => {});
  }, [target]);
  if (!review) return null;
  const open = (f: Finding) => setUi({ openFile: f.file, openLine: f.line, follow: false });
  const fix = (f: Finding) => send({ type: 'prompt', text: `Fix this review finding in ${f.file}:${f.line}: ${f.summary}${f.failure ? ` (${f.failure})` : ''}` });
  const dismiss = (f: Finding) => call<ReviewFindings | null>('/api/findings/dismiss', { target, key: findingKey(f) }).then(setFindings, () => {});
  return (
    <Block title="Findings" count={review.findings.length}>
      {review.findings.length === 0 && <div className="muted small gh-pad">No findings</div>}
      {review.findings.map((f) => (
        <div key={findingKey(f)} className="gh-finding">
          <div className="gh-item click" title={f.failure ?? f.summary} {...pressable(() => open(f))}>
            <Icon name={f.verdict === 'CONFIRMED' ? 'error' : 'warning'} small />
            <span className="gh-msg">{f.summary}</span>
          </div>
          <div className="gh-finding-foot">
            <span className="gh-sha">{f.file}:{f.line}</span>
            <button className="btn xs quiet" onClick={() => fix(f)}>Fix</button>
            <button className="btn xs quiet" onClick={() => dismiss(f)}>Dismiss</button>
          </div>
        </div>
      ))}
    </Block>
  );
}

