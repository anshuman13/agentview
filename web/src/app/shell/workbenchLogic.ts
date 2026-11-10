import { isPage, type Page } from '../pages';
import type { Tab } from './TabBar';

export type Editor = 'file' | 'browser' | 'agents' | 'assistant' | Page;

// What the editor area shows: a phone tab decides for itself, otherwise the editor choice stands.
export const showingOf = (tab: Tab, editor: Editor): Editor =>
  tab === 'assistant' ? 'assistant' : tab === 'browser' ? 'browser' : tab === 'agents' ? 'agents' : tab === 'code' && !isPage(editor) ? 'file' : editor;

// The one editor pane that is shown: the offline notice replaces everything but Codex.
export const activeOf = (showing: Editor, unreachable: boolean, openFile: string | null): Editor | 'offline' | 'empty' =>
  showing === 'assistant' ? 'assistant' : unreachable ? 'offline' : showing === 'browser' || showing === 'agents' || isPage(showing) ? showing : openFile ? 'file' : 'empty';
