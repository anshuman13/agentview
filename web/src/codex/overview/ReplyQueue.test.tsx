import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ItemRow } from '../data/sync';
import { ReplyQueue } from './ReplyQueue';

vi.mock('../data', () => ({ useAssistantStore: () => ({}) }));
vi.mock('../useActions', () => ({ useActions: () => ({}) }));

const row = (id: string, tags: string, extra: Partial<ItemRow> = {}) => ({ id, profile: 'work', title: `Ask ${id}`, people: 'Ada', source: 'slack', status: 'open', tags, draft: 'Hello\nthere', source_url: 'https://x.test/t', ...extra }) as ItemRow;
const html = (rows: ItemRow[]) => renderToStaticMarkup(<ReplyQueue rows={rows} />);
const count = (h: string, s: string) => h.split(s).length - 1;

describe('ReplyQueue rows', () => {
  it('shows one state badge at most', () => {
    const h = html([row('a', 'needs-you'), row('b', 'faq'), row('c', '')]);
    expect(count(h, 'badge waiting')).toBe(1);
    expect(count(h, 'badge quiet')).toBe(1);
    expect(count(h, 'class="badge')).toBe(2);
  });

  it('gives a drafted row Send and More only, with the draft clamped', () => {
    const h = html([row('a', '')]);
    expect(h).toContain('ov-ask-draft clamp');
    expect(count(h, '<button')).toBe(3);
    expect(h).toContain('>Send<');
    expect(h).toContain('aria-label="More"');
    expect(h).not.toContain('>Edit<');
    expect(h).not.toContain('>Skip<');
  });

  it('gives an undrafted row Open and More, and none without a thread', () => {
    const h = html([row('a', 'needs-you', { draft: null })]);
    expect(h).toContain('no draft, open the thread');
    expect(h).toContain('>Open<');
    expect(h).not.toContain('>Send');
    expect(html([row('a', 'needs-you', { draft: null, source_url: null })])).not.toContain('>Open<');
  });
});

describe('ReplyQueue batch actions', () => {
  const faqs = [row('a', 'faq'), row('b', 'faq')];
  const admins = [row('c', 'access'), row('d', 'limit')];

  it('uses one More menu when both kinds have 2+ rows', () => {
    const h = html([...faqs, ...admins]);
    expect(h).not.toContain('ov-admin');
    expect(h).not.toContain('Send all 2 FAQ answers');
  });

  it('uses a single button for one kind and none for fewer than 2', () => {
    expect(html(faqs)).toContain('Send all 2 FAQ answers');
    expect(html(admins)).toContain('Copy 2 access and limit requests');
    const one = html([row('a', 'faq'), row('c', 'access')]);
    expect(one).not.toContain('Send all');
    expect(one).not.toContain('Copy 1');
  });

  it('renders nothing for an empty queue', () => {
    expect(html([])).toBe('');
  });
});
