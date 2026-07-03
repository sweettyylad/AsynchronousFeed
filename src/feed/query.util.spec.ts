import { describe, expect, it } from '@jest/globals';

import { ValidationException } from '../common/exceptions';
import { buildGraffitiQuery, normalizeQuery } from './query.util';

describe('query util', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeQuery('  Cat  ')).toBe('cat');
  });

  it('collapses repeated whitespace between words', () => {
    expect(normalizeQuery('Cat   black\twhite')).toBe('cat black white');
  });

  it('lowercases query for the cache key', () => {
    expect(normalizeQuery('Cute CAT')).toBe('cute cat');
  });

  it('throws a validation error for an empty query after trim', () => {
    expect(() => normalizeQuery('   ')).toThrow(ValidationException);
  });

  it('accepts a 100-character query', () => {
    expect(normalizeQuery('a'.repeat(100))).toHaveLength(100);
  });

  it('throws a validation error for a query longer than 100 characters', () => {
    expect(() => normalizeQuery('a'.repeat(101))).toThrow(ValidationException);
  });

  it('builds the right-side graffiti query from a normalized query', () => {
    expect(buildGraffitiQuery('cat')).toBe('cat graffiti');
  });
});
