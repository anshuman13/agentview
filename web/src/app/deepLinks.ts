import { embedded, presetChat, setUi } from './store';

const params = new URLSearchParams(location.search);
const shellParam = params.get('shell');
if (shellParam) try { localStorage.setItem('agentview.shell', shellParam); } catch {}
// Deep links: ?view=github, ?page=observe, ?chat=<live id>, ?session=<saved id> or ?beside=<live id>. Consumed once, then dropped from the URL.
export const deepLink = { view: params.get('view'), page: params.get('page'), chat: params.get('chat'), session: params.get('session') };
if (deepLink.chat || deepLink.session) presetChat(deepLink.chat, deepLink.session);
if (params.get('beside') && !embedded) setUi({ beside: params.get('beside') });
if (params.size) history.replaceState(null, '', location.pathname);
