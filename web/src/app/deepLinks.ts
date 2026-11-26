import { embedded, presetChat, setUi } from './store';
import { RESUME_PAGE } from './store/view';

const params = new URLSearchParams(location.search);
const shellParam = params.get('shell');
if (shellParam) try { localStorage.setItem('agentview.shell', shellParam); } catch {}
// Deep links: ?view=github, ?page=observe, ?page=sketches&slug=<file name>, ?chat=<live id>, ?session=<saved id> or ?beside=<live id>. Consumed once, then dropped from the URL.
// A reload for a new server boot reopens the page that was on screen.
const resumed = (() => {
  try {
    const p = sessionStorage.getItem(RESUME_PAGE);
    sessionStorage.removeItem(RESUME_PAGE);
    return p;
  } catch {
    return null;
  }
})();
export const deepLink = { view: params.get('view'), page: params.get('page') ?? resumed, slug: params.get('slug'), chat: params.get('chat'), session: params.get('session') };
if (deepLink.chat || deepLink.session) presetChat(deepLink.chat, deepLink.session);
if (deepLink.page === 'sketches' && deepLink.slug) setUi({ sketch: deepLink.slug });
if (params.get('beside') && !embedded) setUi({ beside: params.get('beside') });
if (params.size) history.replaceState(null, '', location.pathname);
