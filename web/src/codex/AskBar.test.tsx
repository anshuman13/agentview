import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from './AskBar';

vi.mock('./data', () => ({ useAssistantStore: () => ({}), useCodex: () => ({ meetings: [] }) }));
vi.mock('./data/ask', () => ({ ask: () => true, askText: () => '' }));
vi.mock('./captureTask', () => ({ captureTask: async () => true }));
vi.mock('../chat/Voice', () => ({ Voice: () => null, useDictation: () => () => {} }));

describe('Composer', () => {
  it('renders no chip row while idle', () => {
    const html = renderToStaticMarkup(<Composer items={[]} filter="all" />);
    expect(html).toContain('Add a task or ask anything');
    expect(html).not.toContain('as-chips');
    expect(html).not.toContain('chip');
  });
});
