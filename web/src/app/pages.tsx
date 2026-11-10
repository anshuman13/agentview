import { Suspense } from 'react';
import { Builds, Deploy, Loading, McpPage, Observe, Settings, Sketches } from './lazy';
import { appSettings } from './appSettings';
import { PhoneHeader } from './shell/PhoneHeader';
import { useCounts } from './store/counts';

export type Page = 'observe' | 'deploy' | 'mcp' | 'builds' | 'sketches' | 'settings';

export const PAGES: { id: Page; icon: string; title: string }[] = [
  { id: 'observe', icon: 'pulse', title: 'Observe' },
  { id: 'deploy', icon: 'rocket', title: 'Deploy' },
  { id: 'mcp', icon: 'plug', title: 'MCP Servers' },
  { id: 'builds', icon: 'beaker', title: 'Builds' },
  { id: 'sketches', icon: 'paintcan', title: 'Sketches' },
  { id: 'settings', icon: 'settings-gear', title: 'Settings' },
];
const available = (id: Page, deploy: boolean) => id !== 'deploy' || deploy;
export const pageOn = (id: Page) => available(id, appSettings.get().deploy);
export const usePages = () => {
  const deploy = appSettings.use((s) => s.deploy);
  return PAGES.filter((p) => available(p.id, deploy));
};
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
        <div className="page-body"><Suspense fallback={<Loading />}>{page === 'mcp' ? <McpPage /> : page === 'builds' ? <Builds shown={shown} /> : page === 'sketches' ? <Sketches shown={shown} /> : page === 'observe' ? <Observe /> : page === 'settings' ? <Settings /> : <Deploy />}</Suspense></div>
      </div>
    </div>
  );
}
