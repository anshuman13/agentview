import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { setUi, useStore } from '../store';

function lang(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') });
  if (ext === 'py') return python();
  if (ext === 'json') return json();
  if (ext === 'md') return markdown();
  if (ext === 'html') return html();
  if (ext === 'css') return css();
  return [];
}

export function CodePane() {
  const openFile = useStore((s) => s.ui.openFile);
  const follow = useStore((s) => s.ui.follow);
  const recent = useStore((s) => s.recentFiles);
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'diff' | 'file'>('diff');
  const [info, setInfo] = useState<{ changed: boolean } | null>(null);

  useEffect(() => {
    if (!openFile || !host.current) return;
    let view: EditorView | MergeView | null = null;
    let cancelled = false;
    fetch(`/api/file?path=${encodeURIComponent(openFile)}`)
      .then((r) => r.json())
      .then((d: { content: string; original: string }) => {
        if (cancelled || !host.current) return;
        host.current.innerHTML = '';
        const changed = d.original !== d.content;
        setInfo({ changed });
        const ext = [lineNumbers(), highlightActiveLine(), oneDark, lang(openFile), EditorView.editable.of(false)];
        if (mode === 'diff' && changed && d.original) {
          view = new MergeView({
            a: { doc: d.original, extensions: ext },
            b: { doc: d.content, extensions: ext },
            parent: host.current,
            collapseUnchanged: { margin: 3, minSize: 4 },
            gutter: true,
          });
        } else {
          view = new EditorView({ state: EditorState.create({ doc: d.content, extensions: ext }), parent: host.current });
        }
      });
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [openFile, mode, recent[0]]);

  return (
    <div className="code-pane">
      <div className="pane-bar">
        <span className="mono path" title={openFile ?? ''}>{openFile ?? 'No file open. Cmd+P to pick one.'}</span>
        <span className="spacer" />
        {info?.changed && (
          <button className={mode === 'diff' ? 'active' : ''} onClick={() => setMode(mode === 'diff' ? 'file' : 'diff')}>
            {mode === 'diff' ? 'Diff' : 'File'}
          </button>
        )}
        <button className={follow ? 'active' : ''} onClick={() => setUi({ follow: !follow })} title="Follow Claude's edits">
          {follow ? 'Following' : 'Pinned'}
        </button>
      </div>
      <div className="editor-host" ref={host} />
    </div>
  );
}
