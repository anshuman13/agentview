import { useEffect, useState } from 'react';
import { openSpecSheet } from '../app/deepLinks';
import { notice, useStore } from '../app/store';
import { Badge } from '../ui/Badge';
import { Button, Chip } from '../ui/Button';
import { MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { ADVISOR_LOOP_BUILDS, ADVISOR_LOOP_EVERY, BOARD_STAGES, advisorBoard, advisorLoopCommand, advisorLoopElsewhere, advisorLoopLine, advisorLoopOf, advisorOf, auditCountLine, auditPrompt, canBuildItem, rankPrompt, specItemPrompt, specsFromAuditPrompt, type Audit, type BacklogItem, type BoardAction, type BoardCard, type BoardStage } from '../../../shared/advisors';
import { specRowParts, type SpecHomeItem } from '../../../shared/builds';
import type { ChatRun } from '../../../shared/protocol';
import { buildItemPrompt, buildSpecPrompt, sketchSpecPrompt } from '../../../shared/specTasks';
import { span } from '../../../shared/util';
import { buildsLine } from '../../../shared/goalText';
import { OUTCOME_DOT } from '../chat/composer/composerLogic';
import { holdBadge } from './buildsLogic';
import { openRun } from './goalLogic';
import { askAdvisor, go } from './advisorChat';
import { since } from './folders';
import { moveBacklogItem } from './sessionApi';

const STAGE_LABEL: Record<BoardStage, string> = { ideas: 'Ideas', specced: 'Specced', building: 'Building', done: 'Done' };
const ACTION_LABEL: Record<BoardAction, string> = { 'spec-it': 'Spec it', approve: 'Approve', 'open-chat': 'Open chat', sketch: 'Sketch', build: 'Build' };

// The Build action of a card: a new chat in the project that builds from the spec, or has the pm agent write it first.
const buildSpec = (root: string, slug: string) => go({ type: 'new_session', cwd: root, hub: true, text: buildSpecPrompt(`.claude/specs/${slug}.md`) });
const sketchSpec = (root: string, slug: string) => go({ type: 'new_session', cwd: root, hub: true, text: sketchSpecPrompt(`.claude/specs/${slug}.md`) });
const buildItem = (root: string, i: BacklogItem) => (i.spec ? buildSpec(root, i.slug) : go({ type: 'new_session', cwd: root, hub: true, text: buildItemPrompt(i.title, i.why, i.slug) }));

const specBadge = (i: SpecHomeItem) =>
  i.waiting || i.hold || i.state === 'waiting' ? <Badge status={holdBadge.status} label={holdBadge.label} /> : i.state === 'running' || i.state === 'failed' ? <Badge status={i.state} /> : undefined;

// A backlog line or spec: its action opens the build chat (with its Spec sheet for Approve when that chat is live), More holds the other next steps and the move.
function CardRow({ card, stage, root, openSlugs, move }: { card: BoardCard; stage: BoardStage; root: string; openSlugs: string[]; move: (slug: string, dir: 'up' | 'down') => void }) {
  const { slug, action, spec, item } = card;
  const isLive = useStore((s) => s.live.some((c) => c.id === spec?.chat));
  const openChat = (sheet: boolean) => {
    if (isLive) {
      go({ type: 'view', id: spec!.chat! });
      if (sheet) openSpecSheet(spec!.chat!, slug);
    } else go({ type: 'open_session', sessionId: spec!.session! });
  };
  const build = () => (spec ? buildSpec(root, slug) : buildItem(root, item!));
  const run: Record<BoardAction, () => void> = { 'spec-it': () => askAdvisor('pm', specItemPrompt(root, item!)), approve: () => openChat(true), 'open-chat': () => openChat(false), sketch: () => sketchSpec(root, slug), build };
  const at = item && item.status !== 'done' ? openSlugs.indexOf(slug) : -1;
  const showBuild = stage === 'ideas' ? canBuildItem(item!) : stage === 'specced' && action !== 'build';
  const showSketch = stage === 'specced' && !!spec && !spec.sketched && action !== 'sketch';
  const { meta, when } = spec ? specRowParts(spec, since) : { meta: item!.why, when: '' };
  return (
    <Row
      title={spec?.title || item!.title}
      meta={meta}
      state={spec && stage !== 'done' ? specBadge(spec) : undefined}
      trailing={when ? <span className="rn-cost">{when}</span> : undefined}
      plain
      action={action && <Button size="sm" variant="tinted" onClick={run[action]}>{ACTION_LABEL[action]}</Button>}
      menu={showBuild || showSketch || at >= 0 ? (
        <>
          {showSketch && <MenuItem icon="paintcan" onClick={() => sketchSpec(root, slug)}>Sketch</MenuItem>}
          {showBuild && <MenuItem icon="play" onClick={build}>Build</MenuItem>}
          {at >= 0 && <MenuItem icon="arrow-up" disabled={at === 0} onClick={() => move(slug, 'up')}>Move up</MenuItem>}
          {at >= 0 && <MenuItem icon="arrow-down" disabled={at === openSlugs.length - 1} onClick={() => move(slug, 'down')}>Move down</MenuItem>}
        </>
      ) : undefined}
    />
  );
}

// The Advisor loop card, first in Building: its last round and Open chat; with no loop, Start sends its goal to the PM chat, disabled for 10 s so a second tap cannot replace it.
function LoopCard({ root, loop }: { root: string; loop: ChatRun | undefined }) {
  const [sent, setSent] = useState(false);
  const elsewhere = advisorLoopElsewhere(useStore((s) => s.runs), root);
  if (!loop && elsewhere) return <Row title="Advisor loop" meta={`Running for ${elsewhere.split('/').pop()} · stop it there to start one here`} plain />;
  if (!loop) {
    const start = () => {
      setSent(true);
      setTimeout(() => setSent(false), 10_000);
      askAdvisor('pm', advisorLoopCommand(root, Date.now()));
    };
    return <Row title="Advisor loop" meta={`Not running · every ${span(ADVISOR_LOOP_EVERY)} · up to ${ADVISOR_LOOP_BUILDS} builds`} plain action={<Button size="sm" variant="tinted" disabled={sent} onClick={start}>Start</Button>} />;
  }
  const last = loop.rounds.at(-1);
  const builds = buildsLine(loop);
  return (
    <Row
      title="Advisor loop"
      meta={advisorLoopLine(loop)}
      leading={last && <span className={`dot ${OUTCOME_DOT[last.outcome]}`} />}
      state={loop.needsYou ? <Badge status={holdBadge.status} label={holdBadge.label} /> : undefined}
      trailing={builds ? <span className="rn-cost">{builds}</span> : undefined}
      plain
      action={<Button size="sm" variant="tinted" onClick={() => openRun(loop)}>Open chat</Button>}
    />
  );
}

// The Designer's newest usability audit, first in Ideas: Specs from audit hands it to the PM, Run audit is in the menu.
function AuditCard({ root, audit, failed, onOpen }: { root: string; audit: Audit | null | undefined; failed?: boolean; onOpen: () => void }) {
  const running = useStore((s) => s.live.some((c) => advisorOf(c.cwd)?.id === 'designer' && c.running));
  return (
    <Row
      title="Audit"
      meta={failed ? 'Could not load the audit' : audit === undefined ? 'Loading the audit' : audit ? `${audit.date} · ${auditCountLine(audit.findings)}` : 'Not run yet'}
      plain
      action={running ? <Badge status="running" /> : <Button size="sm" variant="tinted" disabled={!audit} onClick={() => askAdvisor('pm', specsFromAuditPrompt(root))}>Specs from audit</Button>}
      menu={<>
        <MenuItem icon="list-flat" disabled={!audit} onClick={onOpen}>Open latest audit</MenuItem>
        <MenuItem icon="play" disabled={running} onClick={() => askAdvisor('designer', auditPrompt(root))}>Run audit</MenuItem>
      </>}
    />
  );
}

// One project's board: Ideas, Specced, Building and Done as columns, or as chips with one stage when the page is narrow.
export function AdvisorBoard({ root, backlog, specs, audit, auditFailed }: { root: string; backlog: BacklogItem[] | null | undefined; specs: SpecHomeItem[] | null | undefined; audit: Audit | null | undefined; auditFailed?: boolean }) {
  const loop = advisorLoopOf(useStore((s) => s.runs), root);
  const [moved, setMoved] = useState<BacklogItem[] | null>(null);
  useEffect(() => setMoved(null), [backlog]);
  const items = moved ?? backlog;
  const board = items && specs ? advisorBoard(items, specs, !!loop?.needsYou) : null;
  const [chip, setChip] = useState<BoardStage>();
  const loaded = !!board;
  useEffect(() => { if (board) setChip(board.defaultStage); }, [loaded]);
  const [auditOpen, setAuditOpen] = useState(false);
  if (backlog === undefined || specs === undefined) return <Skeleton rows={6} />;
  if (!board) return <EmptyState size="sm" title="Could not load the board" />;
  const stage = chip ?? board.defaultStage;
  const openSlugs = items!.filter((i) => i.status !== 'done').sort((a, b) => a.rank - b.rank).map((i) => i.slug);
  const move = (slug: string, dir: 'up' | 'down') => moveBacklogItem(root, slug, dir).then((list) => (list ? setMoved(list) : notice('Could not move the item')));
  const nothing = !items!.length;
  return (
    <div className="adv-board">
      <div className="adv-chips">
        {BOARD_STAGES.map((st) => <Chip key={st} on={st === stage} onClick={() => setChip(st)}>{[STAGE_LABEL[st], sectionCount(board.stages[st].length)].filter(Boolean).join(' ')}</Chip>)}
      </div>
      <div className="adv-cols">
        {BOARD_STAGES.map((st) => {
          const cards = board.stages[st];
          const extra = st === 'building' ? <LoopCard root={root} loop={loop} /> : st === 'ideas' ? <AuditCard root={root} audit={audit} failed={auditFailed} onOpen={() => setAuditOpen(true)} /> : null;
          return (
            <section key={st} className={st === stage ? 'adv-col on' : 'adv-col'}>
              <Section label={STAGE_LABEL[st]} count={sectionCount(cards.length)} />
              {(extra || cards.length > 0) && <div className="ui-group">{extra}{cards.map((c) => <CardRow key={c.slug} card={c} stage={st} root={root} openSlugs={openSlugs} move={move} />)}</div>}
              {st === 'ideas' && nothing ? (
                <EmptyState size="sm" icon="list-ordered" title="No backlog yet" hint="The PM ranks what to build next" action={<Button size="sm" variant="tinted" onClick={() => askAdvisor('pm', rankPrompt(root))}>Ask PM to rank</Button>} />
              ) : !cards.length && <div className="adv-none">Nothing here</div>}
            </section>
          );
        })}
      </div>
      {auditOpen && audit && (
        <Sheet label="Audit" onClose={() => setAuditOpen(false)} className="au-sheet">
          <h2>Audit, {audit.date}</h2>
          {audit.findings.map((f) => <Row key={f.rank} leading={f.rank} title={f.screen} meta={`${f.status === 'fixed' ? 'Fixed · ' : ''}${f.severity[0].toUpperCase()}${f.severity.slice(1)} · ${f.problem}. ${f.fix}`} className="bd-clamp" plain />)}
        </Sheet>
      )}
    </div>
  );
}
