import { Suspense } from 'react';
import { Deploy, Loading, McpPage, Observe, Settings } from './lazy';
import { appSettings } from './appSettings';

export type Page = 'observe' | 'deploy' | 'mcp' | 'settings';

export const PAGES: { id: Page; icon: string; title: string; kicker: string; sub: (repo: string) => string }[] = [
  { id: 'observe', icon: 'pulse', title: 'Observe', kicker: 'Grafana · Snowflake', sub: (r) => `Dashboards, logs and data for ${r}. Ask Claude to query Grafana for you.` },
  { id: 'deploy', icon: 'rocket', title: 'Deploy', kicker: 'Deploys', sub: (r) => `Deploys of ${r}: what runs where, and a one-click deploy or rollback.` },
  { id: 'mcp', icon: 'plug', title: 'MCP Servers', kicker: 'Model Context Protocol', sub: () => 'Work and personal servers, grouped by service. Same config as the Claude CLI, checked live.' },
  { id: 'settings', icon: 'settings-gear', title: 'Settings', kicker: 'AgentView', sub: () => 'App preferences and developer tools.' },
];
const available = (id: Page, deploy: boolean) => id !== 'deploy' || deploy;
export const pageOn = (id: Page) => available(id, appSettings.get().deploy);
export const usePages = () => {
  const deploy = appSettings.use((s) => s.deploy);
  return PAGES.filter((p) => available(p.id, deploy));
};
export const isPage = (v: string): v is Page => PAGES.some((p) => p.id === v);
export const pageOf = (id: Page) => PAGES.find((p) => p.id === id)!;

export function PageView({ page, shown, project }: { page: Page; shown: boolean; project: string }) {
  const p = pageOf(page);
  return (
    <div className={`editor ${shown ? 'shown' : ''}`}>
      <div className={`page page-${page}`}>
        <header className="page-hero">
          <div>
            <div className="page-kicker">{p.kicker}</div>
            <h1>{p.title}</h1>
            <div className="page-sub">{p.sub(project)}</div>
          </div>
          <div id={`page-${page}-extra`} className="page-extra" />
        </header>
        <div className="page-body"><Suspense fallback={<Loading />}>{page === 'mcp' ? <McpPage /> : page === 'observe' ? <Observe /> : page === 'settings' ? <Settings /> : <Deploy />}</Suspense></div>
      </div>
    </div>
  );
}
