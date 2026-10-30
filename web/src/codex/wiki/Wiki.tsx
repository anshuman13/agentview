import { lazy, Suspense } from 'react';
import '../../styles/features/wiki.css';
import { useView } from '../view';

export { AskBar } from './AskBar';
export { Feed } from './Feed';
export { PageTile } from './PageTile';
export { SOURCE_ICON, shortDate } from './shared';

const WikiIndex = lazy(() => import('./WikiIndex').then((m) => ({ default: m.WikiIndex })));
const WikiPage = lazy(() => import('./WikiPage').then((m) => ({ default: m.WikiPage })));

export function Wiki({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  return <Suspense fallback={null}>{open ? <WikiPage id={open} /> : <WikiIndex onMenu={onMenu} />}</Suspense>;
}
