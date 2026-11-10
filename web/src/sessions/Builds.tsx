import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setUi, useStore } from '../app/store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { ago } from '../ui/util';
import { pipelineLabel, type BuildRow } from '../../../shared/builds';
import { BuildDetail } from './BuildDetail';
import { FOLD, buildGroups, holdBadge, stateDot } from './buildsLogic';
import { useBuilds } from './useBuilds';

export function BuildList({ builds, onOpen, expanded, onExpand }: { builds: BuildRow[]; onOpen: (slug: string) => void; expanded: string[]; onExpand: (group: string) => void }) {
  const groups = buildGroups(builds);
  return groups.length ? (
    <>
      {groups.map((g) => {
        const rows = g.key === 'active' || expanded.includes(g.key) ? g.rows : g.rows.slice(0, FOLD);
        return (
          <Fragment key={g.key}>
            <Section label={g.label} count={g.rows.length} />
            <div className="ui-group">
              {rows.map((b) => (
                <Row
                  key={b.slug}
                  title={b.title}
                  meta={<>{!b.draft && <span className={`dot ${stateDot(b.state)}`} />} {pipelineLabel(b.pipeline)} · {b.conclusion} · {ago(b.updatedAt, ' ago')}</>}
                  trailing={b.hold ? <Badge {...holdBadge} /> : undefined}
                  onClick={() => onOpen(b.slug)}
                />
              ))}
            </div>
            {rows.length < g.rows.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => onExpand(g.key)}>Show all {g.rows.length}</Button>}
          </Fragment>
        );
      })}
    </>
  ) : (
    <EmptyState size="sm" icon="beaker" title="No builds yet" hint="Specs in .claude/specs show here" />
  );
}

export function Builds({ shown }: { shown: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const { data, failed, reload } = useBuilds(shown && !open);
  const chat = useStore((s) => s.session.id);
  useEffect(() => setOpen(null), [chat]);
  const slug = useStore((s) => s.ui.buildSlug);
  useEffect(() => {
    if (!slug) return;
    setOpen(slug);
    setUi({ buildSlug: null });
  }, [slug]);
  const scroll = useRef<HTMLDivElement>(null);
  const listAt = useRef(0);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = open ? 0 : listAt.current;
  }, [open]);
  const pick = (slug: string | null) => {
    if (slug) listAt.current = scroll.current?.scrollTop ?? 0;
    setOpen(slug);
  };
  return (
    <div className="wk"><div className="wk-scroll" ref={scroll}><div className="mt-page">
      {open ? (
        <BuildDetail key={open} slug={open} shown={shown} onBack={() => pick(null)} />
      ) : data ? (
        <BuildList builds={data} onOpen={pick} expanded={expanded} onExpand={(group) => setExpanded([...expanded, group])} />
      ) : failed ? (
        <EmptyState size="sm" title="Could not load builds" hint="Try again" action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} />
      ) : (
        <Skeleton />
      )}
    </div></div></div>
  );
}
