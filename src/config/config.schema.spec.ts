import { describe, expect, it } from '@jest/globals';

import { validateConfig } from './config.schema';

const requiredEnv = {
  DATABASE_URL: 'postgresql://app:app@localhost:5432/image_feed',
  IMAGE_API_TOKEN: 'image-api-token',
};

describe('validateConfig', () => {
  it('parses a valid env with defaults', () => {
    expect(validateConfig(requiredEnv)).toEqual({
      NODE_ENV: 'production',
      PORT: 3000,
      DATABASE_URL: requiredEnv.DATABASE_URL,
      IMAGE_API_BASE_URL: 'https://service.test.elvetech.io',
      IMAGE_API_TOKEN: requiredEnv.IMAGE_API_TOKEN,
      CACHE_TTL_SECONDS: 3600,
      UPSTREAM_TIMEOUT_MS: 60000,
      UPSTREAM_RETRY_ATTEMPTS: 3,
      PENDING_STALE_SECONDS: 120,
      LOG_LEVEL: 'info',
    });
  });

  it('throws an error with DATABASE_URL when DATABASE_URL is missing', () => {
    expect(() => validateConfig({ IMAGE_API_TOKEN: 'image-api-token' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws an error with IMAGE_API_TOKEN when IMAGE_API_TOKEN is missing', () => {
    expect(() =>
      validateConfig({
        DATABASE_URL: 'postgresql://app:app@localhost:5432/image_feed',
      }),
    ).toThrow(/IMAGE_API_TOKEN/);
  });
});
