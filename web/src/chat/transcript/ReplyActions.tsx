import { useRef, useState } from 'react';
import { getState, notice } from '../../app/store';
import { useNarrow } from '../../app/shell/useNarrow';
import { assistantStore } from '../../codex/data';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { copyText } from '../../ui/util';
import { quoteReply, replyNote } from '../composer/composerLogic';

function saveReply(text: string, cwd: string) {
  const st = getState();
  const note = replyNote(text, st.live.find((c) => c.id === st.session.id)?.title ?? '', cwd);
  assistantStore().capture(note.text, 'note', note.profile).then(() => notice('Saved to Notes'), () => notice('Could not save the note. Try again.'));
}

export function ReplyActions({ text, cwd }: { text: string; cwd: string }) {
  const narrow = useNarrow();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const reply = () => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: quoteReply(text) } }));
  const copy = () => copyText(text).then(() => notice('Copied the reply'), () => notice('Copy failed'));
  const save = () => saveReply(text, cwd);
  if (!narrow) {
    return (
      <>
        <button className="link" title="Quote this reply in the composer" onClick={reply}>Reply</button>
        <button className="link" title="Copy this reply as Markdown" onClick={copy}>Copy</button>
        <button className="link" title="Save this reply to Notes" onClick={save}>Save as note</button>
      </>
    );
  }
  const pick = (act: () => void) => () => { setMenu(false); act(); };
  return (
    <>
      <IconButton ref={more} icon="ellipsis" label="Reply actions" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          <MenuItem icon="reply" onClick={pick(reply)}>Reply</MenuItem>
          <MenuItem icon="copy" onClick={pick(copy)}>Copy</MenuItem>
          <MenuItem icon="notebook" onClick={pick(save)}>Save as note</MenuItem>
        </Menu>
      )}
    </>
  );
}
