import { Suspense } from 'react';
import { shownFeature } from '../../../shared/featureUse';
import { Advisors, Deploy, Loading, McpPage, Observe, Settings, Sketches } from './lazy';
import { appSettings } from './appSettings';
import { PhoneHeader } from './shell/PhoneHeader';
import { useCounts } from './shell/counts';

export type Page = 'advisors' | 'observe' | 'deploy' | 'mcp' | 'sketches' | 'settings';

export const PAGES: { id: Page; icon: string; title: string }[] = [
  { id: 'advisors', icon: 'organization', title: 'Advisors' },
  { id: 'observe', icon: 'pulse', title: 'Observe' },
  { id: 'deploy', icon: 'rocket', title: 'Deploy' },
  { id: 'mcp', icon: 'plug', title: 'MCP Servers' },
  { id: 'sketches', icon: 'paintcan', title: 'Sketches' },
  { id: 'settings', icon: 'settings-gear', title: 'Settings' },
];
const available = (id: Page, deploy: boolean) => id !== 'deploy' || deploy;
export const pageOn = (id: Page) => available(id, appSettings.get().deploy);
export const visiblePages = (deploy: boolean, hidden: string[]) => PAGES.filter((p) => available(p.id, deploy) && shownFeature(`page:${p.id}`, hidden));
export const usePages = () => visiblePages(appSettings.use((s) => s.deploy), appSettings.use((s) => s.hiddenFeatures));
export const isPage = (v: string): v is Page => PAGES.some((p) => p.id === v);
export const pageOf = (id: Page) => PAGES.find((p) => p.id === id)!;

const WITH_ACTION: Page[] = ['observe', 'deploy', 'mcp'];

export function PageView({ page, shown, project, back }: { page: Page; shown: boolean; project: string; back?: () => void }) {
  const p = pageOf(page);
  const { mcp } = useCounts();
  const sub = page === 'mcp' ? (mcp.total ? `${mcp.connected} connected of ${mcp.total}` : undefined) : page === 'observe' || page === 'deploy' ? project : undefined;
  return (
    <div className={`editor ${shown ? 'shown' : ''}`}>
      <div className={`page page-${page}`}>
        {back && <PhoneHeader title={p.title} sub={sub} slot={WITH_ACTION.includes(page) ? `page-${page}-action` : undefined} onBack={back} />}
        <header className="page-hero">
          <h1>{p.title}</h1>
          <div id={`page-${page}-extra`} className="page-extra" />
        </header>
        <div className="page-body"><Suspense fallback={<Loading />}>{page === 'mcp' ? <McpPage /> : page === 'sketches' ? <Sketches shown={shown} /> : page === 'advisors' ? <Advisors shown={shown} /> : page === 'observe' ? <Observe /> : page === 'settings' ? <Settings /> : <Deploy />}</Suspense></div>
      </div>
    </div>
  );
}
