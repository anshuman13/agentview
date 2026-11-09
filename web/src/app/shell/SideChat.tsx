import { useEffect } from 'react';
import { embedded, send, setUi, useStore } from '../store';
import { Icon } from '../../ui/Icon';

export function useSideChat() {
  const chatId = useStore((s) => s.session.id);
  const beside = useStore((s) => (s.ui.beside && s.ui.beside !== s.session.id ? s.ui.beside : null));
  const besideGone = useStore((s) => Boolean(s.ui.beside) && s.live.length > 0 && !s.live.some((c) => c.id === s.ui.beside));

  useEffect(() => {
    if (besideGone) setUi({ beside: null });
    else try { localStorage.setItem('agentview.beside', beside ?? ''); } catch {}
  }, [beside, besideGone]);

  // The side column tells the page which chat it shows; the page keeps the title and the stored id in step.
  useEffect(() => {
    if (embedded) {
      if (chatId) window.parent.postMessage({ type: 'agentview:chat', id: chatId }, location.origin);
      return;
    }
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'agentview:chat' && typeof e.data.id === 'string') setUi({ beside: e.data.id }); };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [chatId]);

  return beside;
}

export function SideChat({ beside }: { beside: string }) {
  const chat = useStore((s) => s.live.find((c) => c.id === s.ui.beside));
  return (
    <section className="main pane center beside desktop-only">
      <div className="beside-head">
        <Icon name="comment-discussion" small />
        <span className="name" title={chat ? `${chat.title}\n${chat.cwd}` : ''}>{chat ? `${chat.cwd.split('/').pop()} · ${chat.title}` : 'Chat'}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Show this chat in the main column" onClick={() => send({ type: 'view', id: beside })}><Icon name="arrow-left" small /></button>
        <button className="icon-btn" title="Close the side chat" onClick={() => setUi({ beside: null })}><Icon name="close" small /></button>
      </div>
      <iframe key={beside} className="beside-frame" title="Side chat" src={`/?chat=${encodeURIComponent(beside)}`} />
    </section>
  );
}
