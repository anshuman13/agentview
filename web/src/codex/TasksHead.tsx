import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Section } from '../ui/Section';
import { FILTER_LABEL, type useView } from './view';

type Props = { list: string; heading: string; filter: ReturnType<typeof useView>['filter']; searching: boolean; selecting: boolean; onMenu: () => void; onAdd: () => void; onSelect: () => void; onSearch: () => void };

export function TasksHead({ list, heading, filter, searching, selecting, onMenu, onAdd, onSelect, onSearch }: Props) {
  return (
    <div className="tasks-head">
      <IconButton icon="menu" label="Lists" className="as-menu" onClick={onMenu} />
      <Section
        label={list === 'today' ? <span role="heading" aria-level={1} className="as-greeting"><Icon name="sparkle" />{heading}</span> : <span role="heading" aria-level={1}>{heading}</span>}
        action={<>
          {list === 'tasks' && !searching && !selecting && <IconButton className="desktop-only" icon="add" label="Add task" onClick={onAdd} />}
          {list === 'tasks' && !searching && !selecting && <IconButton icon="tasklist" label="Select tasks" onClick={onSelect} />}
          {list === 'tasks' && !searching && <IconButton icon="search" label="Search tasks" title="Search tasks (/)" onClick={onSearch} />}
          {filter !== 'all' && <span className="muted">{FILTER_LABEL[filter]}</span>}
        </>}
      />
    </div>
  );
}
