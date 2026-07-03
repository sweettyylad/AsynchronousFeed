import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  MockAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';

import {
  UpstreamBadResponseException,
  UpstreamRateLimitException,
  UpstreamTimeoutException,
} from '../common/exceptions';
import { AppConfig } from '../config/config.schema';
import { ImageProviderService } from './image-provider.service';

const baseUrl = 'https://images.example.test';

function createConfig(
  overrides: Partial<AppConfig> = {},
): ConfigService<AppConfig, true> {
  const config: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://app:app@localhost:5432/image_feed',
    IMAGE_API_BASE_URL: baseUrl,
    IMAGE_API_TOKEN: 'image-api-token',
    CACHE_TTL_SECONDS: 3600,
    UPSTREAM_TIMEOUT_MS: 10000,
    UPSTREAM_RETRY_ATTEMPTS: 3,
    PENDING_STALE_SECONDS: 120,
    LOG_LEVEL: 'silent',
    ...overrides,
  };

  return {
    getOrThrow: <K extends keyof AppConfig>(key: K): AppConfig[K] =>
      config[key],
  } as ConfigService<AppConfig, true>;
}

describe('ImageProviderService', () => {
  const originalDispatcher = getGlobalDispatcher();
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
  });

  it('returns parsed image items from upstream search', async () => {
    const client = mockAgent.get(baseUrl);
    client
      .intercept({
        method: 'GET',
        path: '/search',
        query: { q: 'cat' },
        headers: { 'x-api-token': 'image-api-token' },
      })
      .reply(200, {
        items: [
          {
            url: 'https://cdn.example.test/cat.jpg',
            width: 1200,
            height: 800,
            tags: ['cat', 'cute'],
          },
        ],
      });

    await expect(
      new ImageProviderService(createConfig()).search('cat'),
    ).resolves.toEqual([
      {
        url: 'https://cdn.example.test/cat.jpg',
        width: 1200,
        height: 800,
        tags: ['cat', 'cute'],
      },
    ]);
  });

  it('throws UpstreamBadResponseException for an invalid response body', async () => {
    mockAgent
      .get(baseUrl)
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(200, { items: [{ url: 'not-a-url', width: 1, height: 1 }] });

    await expect(
      new ImageProviderService(createConfig()).search('cat'),
    ).rejects.toBeInstanceOf(UpstreamBadResponseException);
  });

  it('retries 429 responses with backoff and returns a later success', async () => {
    jest.useFakeTimers();
    const client = mockAgent.get(baseUrl);

    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(429, { error: 'rate limited' });
    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(200, { items: [] });

    const search = new ImageProviderService(createConfig()).search('cat');

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1100);

    await expect(search).resolves.toEqual([]);
  });

  it('respects Retry-After before retrying 429 responses', async () => {
    jest.useFakeTimers();
    let attempts = 0;
    const client = mockAgent.get(baseUrl);

    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(429, { error: 'rate limited' }, { headers: { 'retry-after': '2' } });
    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(() => {
        attempts += 1;
        return { statusCode: 200, data: { items: [] } };
      });

    const search = new ImageProviderService(createConfig()).search('cat');

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1999);
    expect(attempts).toBe(0);

    await jest.advanceTimersByTimeAsync(1);

    await expect(search).resolves.toEqual([]);
    expect(attempts).toBe(1);
  });

  it('throws UpstreamRateLimitException when 429 retries are exhausted', async () => {
    jest.useFakeTimers();
    const client = mockAgent.get(baseUrl);

    for (let index = 0; index < 3; index += 1) {
      client
        .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
        .reply(429, { error: 'rate limited' });
    }

    const search = new ImageProviderService(createConfig()).search('cat');
    const assertion = expect(search).rejects.toBeInstanceOf(
      UpstreamRateLimitException,
    );

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1100);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(2100);

    await assertion;
  });

  it('throws UpstreamTimeoutException when upstream exceeds the timeout', async () => {
    jest.useFakeTimers();
    mockAgent
      .get(baseUrl)
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(200, { items: [] })
      .delay(1000);

    const search = new ImageProviderService(
      createConfig({ UPSTREAM_TIMEOUT_MS: 50 }),
    ).search('cat');
    const assertion = expect(search).rejects.toBeInstanceOf(
      UpstreamTimeoutException,
    );

    await jest.advanceTimersByTimeAsync(50);

    await assertion;
  });

  it('retries 5xx responses before returning a later success', async () => {
    jest.useFakeTimers();
    const client = mockAgent.get(baseUrl);

    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(502, { error: 'bad gateway' });
    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'cat' } })
      .reply(200, { items: [] });

    const search = new ImageProviderService(createConfig()).search('cat');

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1100);

    await expect(search).resolves.toEqual([]);
  });
});
