import { useEffect, useRef, useState } from 'react';
import { send, setFindings, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { pressable } from '../ui/util';
import type { Finding } from '../../../shared/protocol';
import '../styles/features/github.css';

import { dismissFinding, fetchFindings } from './opsApi';

// Review Claude's code review findings for a pull request number or "local" for the working tree.
export const REVIEW_LOCAL = '/code-review';

const findingKey = (f: Finding) => `${f.file}:${f.line}:${f.summary.slice(0, 60)}`;

function FindingRow({ f, open, fix, dismiss }: { f: Finding; open: () => void; fix: () => void; dismiss: () => void }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <Row
      plain
      {...pressable(open)}
      leading={<Icon name={f.verdict === 'CONFIRMED' ? 'error' : 'warning'} small />}
      title={<span title={f.failure ?? f.summary}>{f.summary}</span>}
      meta={`${f.file}:${f.line}`}
      trailing={
        <>
          <Button size="sm" onClick={(e) => { e.stopPropagation(); fix(); }}>Fix</Button>
          <span className="as-wrap-more">
            <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }} />
            {menu && (
              <Menu trigger={btn} onClose={() => setMenu(false)}>
                <MenuItem onClick={(e) => { e.stopPropagation(); setMenu(false); dismiss(); }}>Dismiss</MenuItem>
              </Menu>
            )}
          </span>
        </>
      }
    />
  );
}

// What a code or spec review reported, most severe first; a row opens the file on its line.
export function Findings({ target }: { target: string }) {
  const review = useStore((s) => s.findings[target]);
  const cwd = useStore((s) => s.session.cwd);
  // A chat in another repo clears the findings, so fetch that repo's.
  useEffect(() => {
    fetchFindings(target).then(setFindings, () => {});
  }, [target, cwd]);
  if (!review) return null;
  const open = (f: Finding) => setUi({ openFile: f.file, openLine: f.line, follow: false });
  const fix = (f: Finding) => send({ type: 'prompt', text: `Fix this review finding in ${f.file}:${f.line}: ${f.summary}${f.failure ? ` (${f.failure})` : ''}` });
  const dismiss = (f: Finding) => dismissFinding(target, findingKey(f)).then(setFindings, () => {});
  return (
    <>
      <Section label="Findings" count={review.findings.length} />
      {review.findings.length === 0 ? (
        <EmptyState size="sm" title="No findings" />
      ) : (
        <div className="as-group gh-group">
          {review.findings.map((f) => <FindingRow key={findingKey(f)} f={f} open={() => open(f)} fix={() => fix(f)} dismiss={() => dismiss(f)} />)}
        </div>
      )}
    </>
  );
}
