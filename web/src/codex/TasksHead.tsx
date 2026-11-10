import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Section } from '../ui/Section';
import { FILTER_LABEL, type useView } from './view';

type Props = { list: string; heading: string; filter: ReturnType<typeof useView>['filter']; searching: boolean; selecting: boolean; onMenu: () => void; onAdd: () => void; onSelect: () => void; onSearch: () => void };

export function TasksHead({ list, heading, filter, searching, selecting, onMenu, onAdd, onSelect, onSearch }: Props) {
  return (
    <div className="tasks-head">
      <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
      <Section
        label={<span role="heading" aria-level={1}>{heading}</span>}
        action={<>
          {list === 'tasks' && !searching && !selecting && <IconButton className="desktop-only" icon="add" label="Add task" onClick={onAdd} />}
          {list === 'tasks' && !searching && !selecting && <button className="icon-btn" title="Select tasks" aria-label="Select tasks" onClick={onSelect}><Icon name="tasklist" /></button>}
          {list === 'tasks' && !searching && <button className="icon-btn" title="Search tasks (/)" aria-label="Search tasks" onClick={onSearch}><Icon name="search" /></button>}
          {filter !== 'all' && <span className="muted">{FILTER_LABEL[filter]}</span>}
        </>}
      />
    </div>
  );
}
