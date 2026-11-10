import { embedded, presetChat, setUi } from './store';

const params = new URLSearchParams(location.search);
const shellParam = params.get('shell');
if (shellParam) try { localStorage.setItem('agentview.shell', shellParam); } catch {}
// Deep links: ?view=github, ?page=observe, ?page=builds&slug=<spec>, ?page=sketches&slug=<file name>, ?chat=<live id>, ?session=<saved id> or ?beside=<live id>. Consumed once, then dropped from the URL.
export const deepLink = { view: params.get('view'), page: params.get('page'), slug: params.get('slug'), chat: params.get('chat'), session: params.get('session') };
if (deepLink.chat || deepLink.session) presetChat(deepLink.chat, deepLink.session);
if (deepLink.page === 'builds' && deepLink.slug) setUi({ buildSlug: deepLink.slug });
if (deepLink.page === 'sketches' && deepLink.slug) setUi({ sketch: deepLink.slug });
if (params.get('beside') && !embedded) setUi({ beside: params.get('beside') });
if (params.size) history.replaceState(null, '', location.pathname);
