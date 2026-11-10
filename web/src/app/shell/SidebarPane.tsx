import { Suspense } from 'react';
import { AssistantNav, Changes, Explorer, GitHub, OpenChats, Runs, Sessions } from '../lazy';
import { Guard } from './Guard';
import { VIEWS } from './ActivityBar';
import { PhoneHeader } from './PhoneHeader';
import type { Tab, View } from './TabBar';

const PHONE_TITLE: Partial<Record<View, string>> = { changes: 'Source Control', github: 'Pull Requests' };

function SidebarBody({ view }: { view: View }) {
  if (view === 'assistant') return <Guard><Suspense fallback={null}><AssistantNav /></Suspense></Guard>;
  if (view === 'runs') return <Guard><Suspense fallback={null}><Runs /></Suspense></Guard>;
  const Body = view === 'explorer' ? Explorer : view === 'changes' ? Changes : view === 'github' ? GitHub : view === 'chats' ? OpenChats : Sessions;
  return <Suspense fallback={null}><Body /></Suspense>;
}

type Props = { view: View; tab: Tab; chatsView: boolean; setView: (v: View) => void; project: string | undefined; back: () => void };

export function SidebarPane({ view, tab, chatsView, setView, project, back }: Props) {
  const title = tab === 'repos' ? PHONE_TITLE[view] : undefined;
  return (
    <section className="sidebar pane side">
      {title && <PhoneHeader title={title} sub={project} slot={view === 'github' ? 'page-github-action' : undefined} onBack={back} />}
      <div className={`sidebar-title ${title ? 'headed' : ''}`}>{VIEWS.find((v) => v.id === view)!.title}</div>
      {tab === 'repos' && chatsView && (
        <div className="side-switch mobile-only">
          <button className={view !== 'sessions' ? 'active' : ''} onClick={() => setView('chats')}>Sessions</button>
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Repos</button>
        </div>
      )}
      <SidebarBody view={view} />
    </section>
  );
}
