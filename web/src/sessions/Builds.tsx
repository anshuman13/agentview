import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { ago } from '../ui/util';
import { stageName, type BuildRow } from '../../../shared/builds';
import { BuildDetail } from './BuildDetail';
import { stateDot } from './buildsLogic';
import { useBuilds } from './useBuilds';

export function BuildList({ builds, onOpen }: { builds: BuildRow[]; onOpen: (slug: string) => void }) {
  return (
    <>
      <Section label="Builds" count={sectionCount(builds.length)} />
      {builds.length ? (
        <div className="ui-group">
          {builds.map((b) => (
            <Row
              key={b.slug}
              title={b.title}
              meta={<><span className={`dot ${stateDot(b.state)}`} /> {stageName(b.stage)} · {b.conclusion} · {ago(b.updatedAt, ' ago')}</>}
              onClick={() => onOpen(b.slug)}
            />
          ))}
        </div>
      ) : (
        <EmptyState size="sm" icon="beaker" title="No builds yet" hint="Specs the build agents work on show here" />
      )}
    </>
  );
}

export function Builds({ shown }: { shown: boolean }) {
  const { data, failed, reload } = useBuilds(shown);
  const [open, setOpen] = useState<string | null>(null);
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
        <BuildList builds={data} onOpen={pick} />
      ) : failed ? (
        <EmptyState size="sm" title="Could not load builds" hint="Try again" action={<Button size="sm" onClick={() => void reload()}>Retry</Button>} />
      ) : (
        <Skeleton />
      )}
    </div></div></div>
  );
}
