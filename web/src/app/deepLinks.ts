import { embedded, getState, presetChat, setUi, subscribe } from './store';

const params = new URLSearchParams(location.search);
const shellParam = params.get('shell');
if (shellParam) try { localStorage.setItem('agentview.shell', shellParam); } catch {}
// Deep links: ?view=github, ?page=observe, ?page=sketches&slug=<file name>, ?chat=<live id>&slug=<spec slug> (opens its Spec sheet), ?session=<saved id> or ?beside=<live id>. Consumed once, then dropped from the URL.
export const deepLink = { view: params.get('view'), page: params.get('page'), slug: params.get('slug'), chat: params.get('chat'), session: params.get('session') };
if (deepLink.chat || deepLink.session) presetChat(deepLink.chat, deepLink.session);
if (deepLink.page === 'sketches' && deepLink.slug) setUi({ sketch: deepLink.slug });
if (deepLink.chat && deepLink.slug && deepLink.page !== 'sketches') {
  // The Spec card opens the sheet once it loads; give up after 30 s or when another chat is open.
  const stop = () => { off(); clearTimeout(timer); setUi({ spec: null }); };
  const off = subscribe(() => { if (getState().session.id !== deepLink.chat) stop(); });
  const timer = setTimeout(stop, 30_000);
  setUi({ spec: deepLink.slug });
}
if (params.get('beside') && !embedded) setUi({ beside: params.get('beside') });
if (params.size) history.replaceState(null, '', location.pathname);
