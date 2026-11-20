import { describe, expect, it, vi } from 'bun:test';
import * as view from '../codex/view';

const copyText = vi.fn();
vi.mock('../codex/view', () => ({ ...view, copyText }));
const { copyCode } = await import('./MarkdownDoc');

const el = (closest: Record<string, unknown>, code?: string) => ({ closest: (s: string) => closest[s] ?? null, querySelector: () => ({ textContent: code }) }) as unknown as Element;

describe('copyCode', () => {
  it('copies the code of the block whose Copy was clicked with the Code copied snack', () => {
    const block = el({}, 'bun test');
    const button = el({ '.doc-code': block });
    expect(copyCode(el({ '[data-copy]': button }))).toBe(true);
    expect(copyText).toHaveBeenCalledWith('bun test', 'Code copied');
  });

  it('leaves clicks outside a Copy button alone', () => {
    copyText.mockClear();
    expect(copyCode(el({}))).toBe(false);
    expect(copyText).not.toHaveBeenCalled();
  });
});
