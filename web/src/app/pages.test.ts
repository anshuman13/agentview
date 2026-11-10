import { describe, expect, it } from 'vitest';
import { visiblePages } from './pages';

describe('visiblePages', () => {
  it('drops hidden pages', () => {
    expect(visiblePages(true, []).map((p) => p.id)).toContain('builds');
    expect(visiblePages(true, ['page:builds']).map((p) => p.id)).not.toContain('builds');
  });
});
