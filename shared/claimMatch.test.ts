import { describe, expect, it } from 'bun:test';
import { keyWords, overlap, similarClaim } from './claimMatch';

describe('overlap', () => {
  it('is the share of the shorter text key words found in the other', () => {
    expect(overlap(keyWords('gateway limits requests'), keyWords('The gateway limits each user requests per minute'))).toBe(1);
    expect(overlap(keyWords('alpha beta gamma delta epsilon'), keyWords('alpha beta gamma other words'))).toBe(0.6);
  });

  it('is 0 when either side has no key words', () => {
    expect(overlap(keyWords(''), keyWords('gateway limits'))).toBe(0);
    expect(overlap(keyWords('to be or'), keyWords('to be or'))).toBe(0);
  });
});

describe('similarClaim', () => {
  const claims = [{ id: 'a', text: 'alpha beta gamma delta epsilon' }, { id: 'b', text: 'unrelated words entirely' }];

  it('matches at the threshold and not below it', () => {
    expect(similarClaim('alpha beta gamma zulu yankee', claims)?.id).toBe('a');
    expect(similarClaim('alpha beta zulu yankee xray', claims)).toBeUndefined();
  });

  it('returns the best match, the first of equals, and nothing for empty words', () => {
    expect(similarClaim('alpha beta gamma delta zulu', [{ id: 'x', text: 'alpha beta gamma' }, { id: 'y', text: 'alpha beta gamma delta' }])?.id).toBe('x');
    expect(similarClaim('alpha beta gamma', [{ id: 'x', text: 'alpha beta zulu' }, { id: 'y', text: 'alpha beta gamma delta' }])?.id).toBe('y');
    expect(similarClaim('a an', claims)).toBeUndefined();
  });
});
