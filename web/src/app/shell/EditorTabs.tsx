import { setUi, useStore } from '../store';
import { FileIcon } from '../../workspace/FileIcon';
import { Icon } from '../../ui/Icon';
import { pressable } from '../../ui/util';
import { pageOf, type Page } from '../pages';

type Props = {
  showing: string;
  page: Page | null;
  mobileExplorer: boolean;
  sidebar: boolean;
  chatOpen: boolean;
  showFile: () => void;
  showPage: (p: Page) => void;
  showExplorer: () => void;
  closeBrowser: () => void;
  closePage: () => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
};

const reveal = (el: HTMLElement | null) => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });

export function EditorTabs({ showing, page, mobileExplorer, sidebar, chatOpen, showFile, showPage, showExplorer, closeBrowser, closePage, toggleSidebar, toggleChat }: Props) {
  const openFile = useStore((s) => s.ui.openFile);
  const pendingCount = useStore((s) => s.pending.length);
  const fileName = openFile ? openFile.split('/').pop() : null;
  return (
    <div className="tabs">
      <button className={`tab ex-tab mobile-only ${mobileExplorer ? 'active' : ''}`} title="Explorer" onClick={showExplorer}>
        <Icon name="files" small />
      </button>
      {(openFile || showing === 'file') && <div className={`tab ${showing === 'file' && !mobileExplorer ? 'active' : ''}`} {...pressable(showFile)} title={openFile ?? 'Files (⌘E to switch)'}>
        {fileName ? <FileIcon name={fileName} /> : <Icon name="file" small />} {fileName ?? 'File'}
        {openFile && (
          <button className="close" title="Close file" onClick={(e) => { e.stopPropagation(); setUi({ openFile: null }); }}>
            <Icon name="close" small />
          </button>
        )}
      </div>}
      {showing === 'browser' && (
        <div className="tab browser active" title="Browser (⌘E to switch)">
          <Icon name="globe" small /> Browser
          <button className="close" title="Close the browser" onClick={closeBrowser}><Icon name="close" small /></button>
        </div>
      )}
      {page && (
        <div className={`tab ptab ptab-${page} ${showing === page ? 'active' : ''}`} ref={showing === page ? reveal : undefined} {...pressable(() => showPage(page))} title={pageOf(page).title}>
          <Icon name={pageOf(page).icon} small /> {pageOf(page).title}
          <button className="close" title="Close" onClick={(e) => { e.stopPropagation(); closePage(); }}><Icon name="close" small /></button>
        </div>
      )}
      <span className="tabs-spacer desktop-only" />
      <button className="tab-tool desktop-only" title={`${sidebar ? 'Hide' : 'Show'} the left sidebar (⌘B)`} onClick={toggleSidebar}>
        <Icon name={sidebar ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} small />
      </button>
      <button className="tab-tool desktop-only" title={`${chatOpen ? 'Hide' : 'Show'} the chat (⌥⌘B)`} onClick={toggleChat}>
        <Icon name={chatOpen ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} small />
        {!chatOpen && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
      </button>
    </div>
  );
}
