import { useEffect, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { Button } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { ADVISORS, advisorOf, defaultAdvisorRoot } from '../../../shared/advisors';
import { openAdvisor } from './advisorChat';
import { AdvisorBoard } from './AdvisorBoard';
import { AdvisorsSheet } from './AdvisorsSheet';
import { repoRootOf, useWorkspace, type Folder } from './folders';
import { fetchAudit, fetchBacklog, fetchSpecs } from './sessionApi';
import '../styles/features/advisors.css';

let chosenRoot: string | null = null;

// The project the board shows, chosen from the repos.
function ProjectPicker({ root, folders, onPick }: { root: string | null; folders: Folder[]; onPick: (cwd: string) => void }) {
  const [picking, setPicking] = useState(false);
  const pick = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={pick} size="sm" variant="quiet" icon="repo" onClick={() => setPicking(!picking)}>{root?.split('/').pop() ?? 'Project'}</Button>
      {picking && <Menu trigger={pick} onClose={() => setPicking(false)}>{folders.filter((f) => f.repo).map((f) => <MenuItem key={f.cwd} onClick={() => { setPicking(false); onPick(f.cwd); }}>{f.name}</MenuItem>)}</Menu>}
    </>
  );
}

// Loads one project's data when the page shows and after an advisor's turn; failed is set when the request rejects.
function useRootFetch<T>(fetcher: (root: string) => Promise<T>, root: string | null, shown: boolean, turns: string) {
  const [state, setState] = useState<{ root?: string | null; data?: T; failed?: boolean }>({});
  useEffect(() => {
    if (!shown || !root) return;
    let stale = false;
    fetcher(root).then((data) => !stale && setState({ root, data }), () => !stale && setState({ root, failed: true }));
    return () => { stale = true; };
  }, [fetcher, shown, root, turns]);
  return state.root === root ? state : {};
}

// The Advisors page: one project's board from idea to merged build, the Ask buttons for each advisor, and the sheet with their conversations and memory.
export function Advisors({ shown }: { shown: boolean }) {
  const openCwd = useStore((s) => s.session.cwd);
  const [sheet, setSheet] = useState(false);
  const { folders } = useWorkspace('advisors');
  const [picked, setPicked] = useState(chosenRoot);
  const pickRoot = (cwd: string) => {
    chosenRoot = cwd;
    setPicked(cwd);
  };
  const root = picked ?? defaultAdvisorRoot(repoRootOf(openCwd) ?? null, folders.filter((f) => f.repo));
  // Reloads when the page shows and after an advisor's turn, which may have changed the backlog, a spec or the audit.
  // The PM writes the backlog and specs, the Designer the audit; a string per advisor so other live-list changes do not re-render the page.
  const turnsOf = (id?: string) => (s: { live: { id: string; cwd: string; running: boolean; lastActive: number }[] }) => s.live.filter((c) => (id ? advisorOf(c.cwd)?.id === id : advisorOf(c.cwd)) && !c.running).map((c) => `${c.id}:${c.lastActive}`).join();
  const turns = useStore(turnsOf());
  const pmTurns = useStore(turnsOf('pm'));
  const designerTurns = useStore(turnsOf('designer'));
  const backlog = useRootFetch(fetchBacklog, root, shown, pmTurns).data;
  const specs = useRootFetch(fetchSpecs, root, shown, pmTurns).data;
  const { data: audit, failed: auditFailed } = useRootFetch(fetchAudit, root, shown, designerTurns);
  return (
    <div className="wk"><div className="wk-scroll"><div className="mt-page adv-page">
      <div className="adv-head">
        <ProjectPicker root={root} folders={folders} onPick={pickRoot} />
        {ADVISORS.map((a) => <Button key={a.id} size="sm" variant="quiet" onClick={() => openAdvisor(a)}>Ask {a.name}</Button>)}
        <Button size="sm" variant="quiet" icon="comment-discussion" onClick={() => setSheet(true)}>Conversations and memory</Button>
      </div>
      {root ? <AdvisorBoard key={root} root={root} backlog={backlog} specs={specs} audit={audit} auditFailed={auditFailed} /> : <div className="ui-group"><Row title="Pick a project to see its work" plain /></div>}
      {sheet && <AdvisorsSheet turns={turns} onClose={() => setSheet(false)} />}
    </div></div></div>
  );
}
