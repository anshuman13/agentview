import { afterEach, describe, expect, it } from 'bun:test';
import { stubGlobal, unstubAllGlobals } from '../../../testing';

class Node {
  attrs = new Map<string, string>();
  inert = false;
  isConnected = true;
  placed: Node[] = [];
  classList = { add: () => {} };
  constructor(public children: Node[] = [], id?: string) { if (id) this.attrs.set('id', id); }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  cloneNode(): Node { const c = new Node(this.children.map((n) => n.cloneNode())); this.attrs.forEach((v, k) => c.attrs.set(k, v)); return c; }
  querySelectorAll(): Node[] { return this.children.flatMap((n) => [n, ...n.querySelectorAll()]).filter((n) => n.attrs.has('id')); }
  all(): Node[] { return this.children.flatMap((n) => [n, ...n.all()]); }
  before(c: Node) { this.placed.push(c); }
  addEventListener() {}
  remove() {}
}

stubGlobal('matchMedia', () => ({ matches: false }));
const { leaveCopy, cancelLeaving } = await import('./sheetLeave');

describe('leaveCopy', () => {
  afterEach(() => { cancelLeaving(); });

  it('makes the copy inert and strips every id, leaving the original alone', () => {
    const sheet = new Node([new Node([new Node([], 'field')], 'title')], 'sheet');
    leaveCopy([sheet as unknown as HTMLElement]);
    const copy = sheet.placed[0];
    expect(copy.inert).toBe(true);
    expect(copy.attrs.get('aria-hidden')).toBe('true');
    expect([copy, ...copy.all()].filter((n) => n.attrs.has('id'))).toEqual([]);
    expect([sheet, ...sheet.all()].map((n) => n.attrs.get('id'))).toEqual(['sheet', 'title', 'field']);
  });
});

afterEach(() => unstubAllGlobals());
