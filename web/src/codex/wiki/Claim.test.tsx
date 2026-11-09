import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Fact } from '../data/wiki/wiki';
import { Claim } from './Claim';

vi.mock('../data', () => ({ useAssistantStore: () => ({ editRow: vi.fn() }) }));
vi.mock('./Review', () => ({ useReview: () => ({ approve: vi.fn(), reject: vi.fn() }) }));
vi.mock('../view', () => ({ copyText: vi.fn(), openMeeting: vi.fn(), openTask: vi.fn(), showSnack: vi.fn() }));

const sources = JSON.stringify([
  { kind: 'slack', label: 'first-thread', url: 'https://example.com/a' },
  { kind: 'doc', label: 'second-doc', url: 'https://example.com/b' },
]);
const fact = { id: 'f1', profile: 'work', text: 'Alpha owns billing', sources, added_by: 'claude:sess-1', at: Date.now() - 86_400_000, state: null } as unknown as Fact;

describe('Claim', () => {
  it('shows one source chip and no date or Claude link in the row', () => {
    const h = renderToStaticMarkup(<Claim fact={fact} old={[]} page="Alpha" flash={false} />);
    expect(h).toContain('Alpha owns billing');
    expect(h.match(/aria-label="(Slack|Doc): /g)).toHaveLength(1);
    expect(h).not.toContain('second-doc');
    expect(h).not.toContain('wk-claim-date');
    expect(h).not.toContain('Updated');
    expect(h).not.toContain('?session=');
  });
});
