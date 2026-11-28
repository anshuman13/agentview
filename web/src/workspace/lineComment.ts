import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from '@codemirror/view';
import { commentLabel, type LineComment } from '../../../shared/lineComment';


export type OpenComment = { line: number; text: string; staged: boolean };

export const setComment = StateEffect.define<OpenComment | null>();

export const commentField = StateField.define<OpenComment | null>({
  create: () => null,
  update: (v, tr) => tr.effects.reduce<OpenComment | null>((cur, e) => (e.is(setComment) ? e.value : cur), v),
});

export const stageComment = (path: string, state: EditorState, open: OpenComment): LineComment | null => {
  const text = open.text.trim();
  if (!text || open.line > state.doc.lines) return null;
  return { path, line: open.line, code: state.doc.line(open.line).text, text };
};

class CommentBox extends WidgetType {
  constructor(readonly open: OpenComment, readonly path: string) { super(); }
  eq(o: CommentBox) { return o.open.line === this.open.line && o.open.staged === this.open.staged && o.path === this.path; }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = `cd-comment${this.open.staged ? ' staged' : ''}`;
    const head = box.appendChild(document.createElement('div'));
    head.className = 'cd-comment-head';
    head.textContent = commentLabel(this.open.line, this.open.staged);
    if (this.open.staged) {
      box.appendChild(document.createElement('div')).textContent = this.open.text;
      return box;
    }
    const input = box.appendChild(document.createElement('input'));
    input.placeholder = 'Tell Claude what to change';
    input.setAttribute('aria-label', `Comment on line ${this.open.line}`);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') view.dispatch({ effects: setComment.of(null) });
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const open = { ...this.open, text: input.value };
      const c = stageComment(this.path, view.state, open);
      if (!c) return;
      window.dispatchEvent(new CustomEvent('agentview:comment', { detail: c }));
      view.dispatch({ effects: setComment.of({ ...open, staged: true }) });
    });
    setTimeout(() => input.focus());
    return box;
  }
  ignoreEvent() { return true; }
}

class Plus extends GutterMarker {
  toDOM() {
    const b = document.createElement('span');
    b.className = 'cd-comment-plus';
    b.textContent = '+';
    b.title = 'Comment on this line';
    return b;
  }
}
const plus = new Plus();

// The + gutter and the inline comment box under its line, for the current side of a diff.
export function lineComments(path: string) {
  const boxes = EditorView.decorations.compute([commentField], (state): DecorationSet => {
    const open = state.field(commentField);
    if (!open || open.line > state.doc.lines) return Decoration.none;
    const at = state.doc.line(open.line).to;
    return Decoration.set([Decoration.widget({ widget: new CommentBox(open, path), block: true, side: 1 }).range(at)]);
  });
  return [
    commentField,
    boxes,
    gutter({
      class: 'cd-comment-gutter',
      lineMarker: () => plus,
      domEventHandlers: {
        mousedown: (view, block) => {
          const line = view.state.doc.lineAt(block.from).number;
          view.dispatch({ effects: setComment.of({ line, text: '', staged: false }) });
          return true;
        },
      },
    }),
  ];
}
