import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { showChat } from '../ui/util';
import { MARK_COLOURS, markHex, markOps, type Mark, type MarkOp, type MarkTool } from '../../../shared/markup';

const TOOLS: { tool: MarkTool; icon: string; label: string }[] = [
  { tool: 'pen', icon: 'edit', label: 'Pen' },
  { tool: 'box', icon: 'primitive-square', label: 'Box' },
  { tool: 'text', icon: 'text-size', label: 'Text' },
];

function OpSvg({ op }: { op: MarkOp }) {
  if (op.t === 'pen') return <polyline points={op.pts.join(' ')} fill="none" stroke={op.color} strokeWidth={op.width} strokeLinecap="round" strokeLinejoin="round" />;
  if (op.t === 'box') return <rect x={op.x} y={op.y} width={op.w} height={op.h} fill="none" stroke={op.color} strokeWidth={op.width} rx={op.width} />;
  return <text x={op.x} y={op.y} fill={op.color} fontSize={op.size} fontFamily="system-ui, sans-serif" dominantBaseline="hanging">{op.text}</text>;
}

function drawOp(g: CanvasRenderingContext2D, op: MarkOp) {
  g.strokeStyle = g.fillStyle = op.color;
  if (op.t === 'text') {
    g.font = `${op.size}px system-ui, sans-serif`;
    g.textBaseline = 'top';
    g.fillText(op.text, op.x, op.y);
    return;
  }
  g.lineWidth = op.width;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  if (op.t === 'box') g.roundRect(op.x, op.y, op.w, op.h, op.width);
  else op.pts.forEach((v, i) => i % 2 && (i === 1 ? g.moveTo(op.pts[0], v) : g.lineTo(op.pts[i - 1], v)));
  g.stroke();
}

// The frame and the marks as one PNG, at the frame's own size.
async function composite(img: HTMLImageElement, marks: Mark[]) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  markOps(marks, c.width, c.height).forEach((op) => drawOp(g, op));
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  return blob && new File([blob], 'browser-markup.png', { type: 'image/png' });
}

// Markup over the browser frame (Claude.app's markup toolbar): pen, box and text in a colour, drawn on a layer over the
// frame while input to Chrome is off, and Add to chat attaches the frame with the marks to the composer.
export function Markup({ img, onClose }: { img: RefObject<HTMLImageElement | null>; onClose: () => void }) {
  const [tool, setTool] = useState<MarkTool>('pen');
  const [colour, setColour] = useState('Clay');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0, w: 1, h: 1 });
  const [colours, setColours] = useState(false);
  const colourBtn = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const el = img.current;
    if (!el) return;
    const measure = () => setRect({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight, w: el.naturalWidth || 1, h: el.naturalHeight || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('load', measure);
    return () => { ro.disconnect(); el.removeEventListener('load', measure); };
  }, [img]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !typing) { e.preventDefault(); onClose(); }
      const field = (e.target as HTMLElement).closest?.('input, textarea, [contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing && !field) { e.preventDefault(); setMarks((l) => l.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [typing, onClose]);

  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const commitText = () => {
    if (typing?.text.trim()) setMarks((l) => [...l, { t: 'text', c: colour, x: typing.x, y: typing.y, text: typing.text }]);
    setTyping(null);
  };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const p = at(e);
    if (tool === 'text') {
      commitText();
      setTyping({ ...p, text: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft(tool === 'pen' ? { t: 'pen', c: colour, pts: [p.x, p.y] } : { t: 'box', c: colour, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = at(e);
    setDraft(draft.t === 'pen' ? { ...draft, pts: [...draft.pts, p.x, p.y] } : draft.t === 'box' ? { ...draft, x1: p.x, y1: p.y } : draft);
  };
  const onUp = () => {
    if (draft && markOps([draft], rect.w, rect.h).length) setMarks((l) => [...l, draft]);
    setDraft(null);
  };
  const add = async () => {
    if (!img.current) return;
    const file = await composite(img.current, marks);
    if (!file) return;
    showChat();
    window.dispatchEvent(new CustomEvent('agentview:attach', { detail: [file] }));
    setMarks([]);
  };

  const ops = markOps(draft ? [...marks, draft] : marks, rect.w, rect.h);
  return (
    <>
      <svg
        className={`markup-layer tool-${tool}`}
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        viewBox={`0 0 ${rect.w} ${rect.h}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDraft(null)}
      >
        {ops.map((op, i) => <OpSvg key={i} op={op} />)}
      </svg>
      {typing && (
        <input
          className="markup-text"
          autoFocus
          aria-label="Text on the page"
          style={{ left: rect.left + typing.x * rect.width, top: rect.top + typing.y * rect.height, color: markHex(colour) }}
          value={typing.text}
          onChange={(e) => setTyping({ ...typing, text: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commitText(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyping(null); }
          }}
        />
      )}
      <div className="markup-bar" role="toolbar" aria-label="Markup">
        {TOOLS.map((t) => <IconButton key={t.tool} icon={t.icon} label={t.label} on={tool === t.tool} aria-pressed={tool === t.tool} onClick={() => { commitText(); setTool(t.tool); }} />)}
        <span className="markup-colours">
          <button ref={colourBtn} type="button" className="icon-btn icon-btn-md markup-colour" aria-label={`Colour: ${colour}`} title="Colour" onClick={() => setColours((v) => !v)}>
            <span className="markup-swatch" style={{ background: markHex(colour) }} />
          </button>
          {colours && (
            <Menu trigger={colourBtn} onClose={() => setColours(false)}>
              {MARK_COLOURS.map((c) => (
                <MenuItem key={c.name} icon={c.name === colour ? 'check' : 'blank'} onClick={() => { setColour(c.name); setColours(false); }}>
                  <span className="markup-swatch" style={{ background: c.hex }} /> {c.name}
                </MenuItem>
              ))}
            </Menu>
          )}
        </span>
        <IconButton icon="discard" label="Undo" disabled={!marks.length} onClick={() => setMarks((l) => l.slice(0, -1))} />
        <IconButton icon="trash" label="Clear marks" disabled={!marks.length} onClick={() => setMarks([])} />
        <Button size="sm" onClick={() => void add()}>Add to chat</Button>
        <IconButton icon="close" label="Close markup" onClick={onClose} />
      </div>
    </>
  );
}
