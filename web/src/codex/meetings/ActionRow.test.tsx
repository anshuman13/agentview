import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ItemRow } from '../data/sync';
import { ActionRow } from './ActionRow';

vi.mock('../data', () => ({ useAssistantStore: () => ({ update: vi.fn() }) }));

const html = (status: string) => renderToStaticMarkup(<ActionRow row={{ id: 'a', title: 'Send notes', status } as ItemRow} />);

describe('ActionRow swipe', () => {
  it('wraps only open rows in Swipe', () => {
    expect(html('open')).toContain('as-swipe');
    expect(html('suggested')).not.toContain('as-swipe');
    expect(html('done')).not.toContain('as-swipe');
  });
});
