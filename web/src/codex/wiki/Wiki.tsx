import '../../styles/features/wiki.css';
import { useView } from '../view';
import { WikiIndex } from './WikiIndex';
import { WikiPage } from './WikiPage';

export { AskBar } from './AskBar';
export { Feed } from './Feed';
export { PageTile } from './PageTile';
export { SOURCE_ICON, shortDate } from './shared';

export function Wiki({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  return open ? <WikiPage id={open} /> : <WikiIndex onMenu={onMenu} />;
}
