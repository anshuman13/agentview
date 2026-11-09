import { useEffect, useState } from 'react';
import { setUi, useStore } from '../app/store';
import { setOpened, useOpened } from './opened';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row as UiRow } from '../ui/Row';
import { Section } from '../ui/Section';
import { pressable, save, stored } from '../ui/util';
import { FileIcon } from './FileIcon';
import { parentOf } from './useFileTree';

export function OpenEditors() {
  const openFile = useStore((s) => s.ui.openFile);
  const recent = useStore((s) => s.recentFiles);
  const opened = useOpened();
  const [editorsOpen, setEditorsOpen] = useState<boolean>(() => stored('explorer.editors', true));
  useEffect(() => save('explorer.editors', editorsOpen), [editorsOpen]);

  const close = (f: string) => {
    const i = opened.indexOf(f);
    const rest = opened.filter((x) => x !== f);
    setOpened(rest);
    if (f === openFile) setUi({ openFile: rest[Math.min(i, rest.length - 1)] ?? null, follow: false });
  };

  return (
    <>
      <Section
        label="Open Editors"
        count={opened.length || undefined}
        open={editorsOpen}
        onToggle={() => setEditorsOpen(!editorsOpen)}
        action={opened.length > 0 && <IconButton icon="close-all" label="Close All Editors" size="sm" small onClick={() => { setOpened([]); setUi({ openFile: null, follow: false }); }} />}
      />
      {editorsOpen && (
        <div className="ex-editors">
          {opened.length === 0 && <EmptyState size="sm" title="No open files" hint="Files you open or the agent edits show here" />}
          {opened.map((f) => {
            const name = f.split('/').pop();
            return (
              <UiRow
                key={f}
                plain
                aria-current={f === openFile || undefined}
                data-path={f}
                leading={<FileIcon name={f} />}
                title={<span title={f} className={`ex-name${recent.includes(f) ? ' changed' : ''}`}>{name}</span>}
                meta={parentOf(f)}
                trailing={
                  <IconButton icon="close" label={`Close ${name}`} title="Close" size="sm" small onClick={(e) => {
                    e.stopPropagation();
                    const row = e.currentTarget.closest('.ui-row');
                    ((row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null | undefined)?.focus();
                    close(f);
                  }} />
                }
                {...pressable(() => setUi({ openFile: f, follow: false }))}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
