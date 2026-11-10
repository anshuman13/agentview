import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { getState, useStore } from '../store';
import { haptic } from '../../ui/haptic';
import { slideFrom, useTabSwipe } from '../touch/tabSwipe';
import { deepLink } from '../deepLinks';
import { loadAppSettings } from '../appSettings';
import { track } from '../featureUse';
import { isPage, type Page } from '../pages';
import { useTheme } from '../theme';
import type { Tab, View } from './TabBar';
import { useUnreachable } from './Unreachable';
import { useDeepLink } from './useDeepLink';
import { useWorkbenchKeys } from './useWorkbenchKeys';
import { useWorkbenchCommands } from './useWorkbenchCommands';
import { activeOf, showingOf, type Editor } from './workbenchLogic';

export const narrow = () => window.innerWidth <= 900;

// The workbench's navigation: the phone tab, the desktop editor, the sidebar view and the panes that open and close.
export function useWorkbench() {
  const pendingCount = useStore((s) => s.pending.length);
  const openFile = useStore((s) => s.ui.openFile);
  const chatId = useStore((s) => s.session.id);
  const [tab, setTab] = useState<Tab>(() => (narrow() && !deepLink.chat && !deepLink.session ? 'assistant' : 'chat'));
  const [editor, setEditor] = useState<Editor>('file');
  const [seenAssistant, setSeenAssistant] = useState(false);
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [more, setMore] = useState(false);
  const [browse, setBrowse] = useState(false);
  const openPage = (p: Page) => { track(`page:${p}`); setPage(p); setEditor(p); setTab((t) => (narrow() ? 'code' : t)); };
  const closePage = () => { setPage(null); setEditor((e) => (isPage(e) ? 'file' : e)); };
  const [sidebar, setSidebar] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState<View>('explorer');
  const [phone, setPhone] = useState(false);
  const [macs, setMacs] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [theme, toggleTheme] = useTheme();

  const showView = (v: View) => {
    if (v === 'assistant') return openAssistant(view === 'assistant' && editor === 'assistant' && sidebar);
    if (editor === 'assistant') { setEditor('file'); setView(v); setSidebar(true); return; }
    if (v === view) setSidebar((s) => !s);
    else { setView(v); setSidebar(true); }
  };
  // Desktop: the lists go in the sidebar and the feed in the editor area. Phone: its own tab.
  const openAssistant = (toggleSidebar = false) => {
    setMore(false);
    setEditor('assistant');
    if (narrow()) setTab('assistant');
    else if (toggleSidebar) setSidebar(false);
    else { setView('assistant'); setSidebar(true); }
    window.dispatchEvent(new Event('assistant:shown'));
  };

  useEffect(() => {
    if (pendingCount > 0) setTab('chat');
  }, [pendingCount]);

  // The first init swaps the preset chat id for the server's; that is not a chat switch, so a deep-linked view stays.
  const prevId = useRef(chatId);
  const [fromRepos, setFromRepos] = useState(false);
  useEffect(() => {
    const from = prevId.current;
    prevId.current = chatId;
    if (deepLink.view && from === deepLink.chat) return;
    setTab((t) => {
      if (t !== 'repos') return t;
      slideFrom(1);
      setFromRepos(true);
      return 'chat';
    });
  }, [chatId]);
  useEffect(() => { if (tab !== 'chat') setFromRepos(false); }, [tab]);

  useEffect(() => {
    const show = () => { setTerminal(true); setTab((t) => (narrow() ? 'term' : t)); };
    window.addEventListener('agentview:terminal', show);
    return () => window.removeEventListener('agentview:terminal', show);
  }, []);
  useEffect(() => {
    const show = () => setTab((t) => (narrow() ? 'chat' : t));
    window.addEventListener('agentview:chat', show);
    return () => window.removeEventListener('agentview:chat', show);
  }, []);

  useEffect(() => void loadAppSettings(), []);
  useWorkbenchKeys({
    toggleChat: () => setChatOpen((v) => !v),
    toggleSidebar: () => setSidebar((v) => !v),
    toggleTerminal: () => setTerminal((v) => !v),
    switchEditor: () => setEditor((v) => (v === 'file' ? 'browser' : 'file')),
  });

  // A file Claude edits while a page or the browser is shown goes to Open Editors without taking the editor.
  useEffect(() => {
    if (!openFile) return;
    if (getState().ui.follow && editor !== 'file') return;
    setEditor('file');
    setBrowse(false);
    if (narrow() && !getState().ui.follow) setTab((t) => (t === 'chat' || t === 'repos' ? 'code' : t));
  }, [openFile]);

  useEffect(() => {
    const open = (e: Event) => {
      if (!narrow()) return setChatOpen(true);
      const id = (e as CustomEvent<unknown>).detail;
      setAgentSel(typeof id === 'string' ? id : null);
      setEditor('agents');
      setTab((t) => (narrow() ? 'agents' : t));
    };
    window.addEventListener('open-agent', open);
    return () => window.removeEventListener('open-agent', open);
  }, []);

  useWorkbenchCommands({
    openAssistant, openPage, toggleTheme, setView, setSidebar, setTab, setEditor, setBrowse, setChatOpen, setTerminal, setPhone,
  });

  useDeepLink(chatId);

  const showing = showingOf(tab, editor);
  const unreachable = useUnreachable();
  const active = activeOf(showing, unreachable, openFile);
  const mobileExplorer = tab === 'code' && (!openFile || browse) && !isPage(editor);
  const chatsView = view === 'chats' || view === 'sessions';
  const inChats = tab === 'repos' && chatsView;
  const inMore = tab === 'term' || tab === 'browser' || tab === 'code' || (tab === 'repos' && !chatsView);
  const goTab = (t: Tab) => {
    haptic();
    setMore(false);
    if (t === 'code' && tab === 'code' && !isPage(editor) && openFile) setBrowse((v) => !v);
    if (t === 'agents' && tab === 'agents') setAgentSel(null);
    setTab(t);
    if (t === 'agents') setEditor('agents');
    if (t === 'browser') setEditor('browser');
    if (t === 'code') setEditor('file');
    if (t === 'assistant') { setEditor('assistant'); window.dispatchEvent(new Event('assistant:shown')); }
  };
  const home = useRef<Tab>('assistant');
  useEffect(() => { if (!inMore) home.current = tab; }, [tab, inMore]);
  const goHome = () => { if (home.current === 'repos') goSide('chats'); else goTab(home.current); };
  const closeTool = () => { closePage(); goHome(); };
  useEffect(() => { if (showing === 'assistant') setSeenAssistant(true); }, [showing]);
  const goSide = (v: View) => { haptic(); setMore(false); setView(v); setTab('repos'); };
  const swipeTabs = [() => goTab('assistant'), () => goTab('chat'), () => goSide('chats'), () => goTab('agents')];
  useTabSwipe(more ? -1 : tab === 'assistant' ? 0 : tab === 'chat' ? 1 : inChats ? 2 : tab === 'agents' ? 3 : -1, swipeTabs.length, (i) => swipeTabs[i]());
  const reopen = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>('[data-path]');
    if (row && !el.closest('button') && row.dataset.path === openFile) setBrowse(false);
  };

  return {
    openFile, chatId, tab, setTab, editor, setEditor, seenAssistant, agentSel, setAgentSel, page, more, setMore, browse, setBrowse, sidebar, setSidebar,
    chatOpen, setChatOpen, view, setView, phone, setPhone, macs, setMacs, terminal, setTerminal, theme, toggleTheme,
    showView, openPage, closePage, fromRepos, showing, active, unreachable, mobileExplorer, chatsView, inChats, inMore, goTab, goSide, goHome, closeTool, reopen,
  };
}
