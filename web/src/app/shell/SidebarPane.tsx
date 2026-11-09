import { Suspense } from 'react';
import { AssistantNav, Changes, Explorer, GitHub, OpenChats, Runs, Sessions } from '../lazy';
import { Guard } from './Guard';
import { VIEWS } from './ActivityBar';
import type { Tab, View } from './TabBar';

function SidebarBody({ view }: { view: View }) {
  if (view === 'assistant') return <Guard><Suspense fallback={null}><AssistantNav /></Suspense></Guard>;
  if (view === 'runs') return <Guard><Suspense fallback={null}><Runs /></Suspense></Guard>;
  const Body = view === 'explorer' ? Explorer : view === 'changes' ? Changes : view === 'github' ? GitHub : view === 'chats' ? OpenChats : Sessions;
  return <Suspense fallback={null}><Body /></Suspense>;
}

export function SidebarPane({ view, tab, chatsView, setView }: { view: View; tab: Tab; chatsView: boolean; setView: (v: View) => void }) {
  return (
    <section className="sidebar pane side">
      <div className="sidebar-title">{VIEWS.find((v) => v.id === view)!.title}</div>
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
