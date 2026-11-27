// Marks drawn over the browser frame before it goes to the chat as a PNG. Android: workspace/MarkupLogic.kt.
// Points are fractions of the frame (0 to 1), so the marks keep their place when the frame is drawn at another size.
export type MarkTool = 'pen' | 'box' | 'text';
export type Mark =
  | { t: 'pen'; c: string; pts: number[] }
  | { t: 'box'; c: string; x0: number; y0: number; x1: number; y1: number }
  | { t: 'text'; c: string; x: number; y: number; text: string };

export const MARK_COLOURS = [
  { name: 'Clay', hex: '#D97757' },
  { name: 'Red', hex: '#E5372E' },
  { name: 'Blue', hex: '#2D7FF9' },
  { name: 'Green', hex: '#30A14E' },
  { name: 'Black', hex: '#1F1E1D' },
  { name: 'White', hex: '#FFFFFF' },
];

export const markHex = (c: string) => (MARK_COLOURS.find((m) => m.name === c) ?? MARK_COLOURS[0]).hex;

// What to draw for each mark on a frame w by h pixels: pixel coordinates, stroke width and text size.
export type MarkOp =
  | { t: 'pen'; color: string; width: number; pts: number[] }
  | { t: 'box'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { t: 'text'; color: string; size: number; x: number; y: number; text: string };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function markOps(marks: Mark[], w: number, h: number): MarkOp[] {
  const side = Math.min(w, h);
  const width = Math.max(2, Math.round(side / 160));
  const size = Math.max(12, Math.round(side / 28));
  return marks.flatMap((m): MarkOp[] => {
    const color = markHex(m.c);
    if (m.t === 'pen') return m.pts.length < 4 ? [] : [{ t: 'pen', color, width, pts: m.pts.map((v, i) => r1(v * (i % 2 ? h : w))) }];
    if (m.t === 'box') {
      const x = r1(Math.min(m.x0, m.x1) * w), y = r1(Math.min(m.y0, m.y1) * h);
      const bw = r1(Math.abs(m.x1 - m.x0) * w), bh = r1(Math.abs(m.y1 - m.y0) * h);
      return bw < 2 && bh < 2 ? [] : [{ t: 'box', color, width, x, y, w: bw, h: bh }];
    }
    const text = m.text.trim();
    return text ? [{ t: 'text', color, size, x: r1(m.x * w), y: r1(m.y * h), text }] : [];
  });
}
