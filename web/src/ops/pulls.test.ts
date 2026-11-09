import { describe, expect, it } from 'vitest';
import { prText } from './pulls';

describe('prText', () => {
  it('shows the number alone without PR details', () => expect(prText(7)).toBe('#7'));
  it('shows Draft before the review state', () => expect(prText(9, { draft: true, review: 'APPROVED' })).toBe('#9 · Draft'));
  it('shows the review state', () => expect(prText(2, { draft: false, review: 'CHANGES_REQUESTED' })).toBe('#2 · Changes requested'));
  it('drops an unknown review state', () => expect(prText(3, { draft: false, review: '' })).toBe('#3'));
});
