import { Suspense } from 'react';
import { Deploy, Loading, McpPage, Observe } from './lazy';

export type Page = 'observe' | 'deploy' | 'mcp';

export const PAGES: { id: Page; icon: string; title: string; kicker: string; sub: (repo: string) => string }[] = [
  { id: 'observe', icon: 'pulse', title: 'Observe', kicker: 'Grafana · Snowflake', sub: (r) => `Dashboards, logs and data for ${r}. Ask Claude to query Grafana for you.` },
  { id: 'deploy', icon: 'rocket', title: 'Deploy', kicker: 'Velodrome', sub: (r) => `Deploys of ${r}: what runs where, and a one-click deploy or rollback.` },
  { id: 'mcp', icon: 'plug', title: 'MCP Servers', kicker: 'Model Context Protocol', sub: () => 'Work and personal servers, grouped by service. Same config as the Claude CLI, checked live.' },
];
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
        <div className="page-body"><Suspense fallback={<Loading />}>{page === 'mcp' ? <McpPage /> : page === 'observe' ? <Observe /> : <Deploy />}</Suspense></div>
      </div>
    </div>
  );
}
