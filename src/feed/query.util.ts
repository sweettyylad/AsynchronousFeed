import { ValidationException } from '../common/exceptions';
import { MAX_QUERY_LENGTH } from './query.constants';

export function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase();

  if (!normalized) {
    throw new ValidationException('Query must not be empty');
  }

  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new ValidationException(
      `Query must be at most ${MAX_QUERY_LENGTH} characters`,
    );
  }

  return normalized;
}

export function buildGraffitiQuery(normalizedQuery: string): string {
  return `${normalizedQuery} graffiti`;
}
