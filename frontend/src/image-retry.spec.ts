import { describe, expect, it } from '@jest/globals';

import { withImageRetryParam } from './image-retry';

describe('withImageRetryParam', () => {
  it('adds retry cache buster while preserving existing query params', () => {
    expect(withImageRetryParam('https://images.test/cat.jpg?size=large', 2)).toBe(
      'https://images.test/cat.jpg?size=large&retry=2',
    );
  });
});
