import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { Server } from 'node:http';
import {
  MockAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';

import { SearchStatus } from '../src/generated/prisma/enums';
import { SearchResultItem } from '../src/feed/search-result.repository';
import { E2eApp, startE2eApp } from './helpers/e2e-app';

const baseUrl = 'https://service.test.elvetech.io';

const catItem = {
  url: 'https://cdn.example.test/cat.jpg',
  width: 1200,
  height: 800,
  tags: ['cat', 'cute'],
};

const graffitiItem = {
  url: 'https://cdn.example.test/cat-graffiti.jpg',
  width: 900,
  height: 900,
  tags: ['cat', 'graffiti'],
};

describe('Feed API e2e', () => {
  const originalDispatcher = getGlobalDispatcher();
  let e2e: E2eApp;
  let mockAgent: MockAgent;

  beforeAll(async () => {
    e2e = await startE2eApp();
  }, 120000);

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await e2e.prisma.searchResult.deleteMany();
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
  });

  afterAll(async () => {
    await e2e.stop();
  });

  it('submits pending sides and later returns paired feed items', async () => {
    mockSearch('cat', [catItem]);
    mockSearch('cat graffiti', [graffitiItem]);

    await postSearch('cat')
      .expect(202)
      .expect((response) => {
        const body = response.body as SuccessEnvelope<SearchAcceptedData>;

        expect(body.data).toEqual({
          query: 'cat',
          left: { query: 'cat', status: 'PENDING' },
          right: { query: 'cat graffiti', status: 'PENDING' },
        });
      });

    await getFeed('cat')
      .expect(200)
      .expect((response) => {
        const body = response.body as SuccessEnvelope<FeedData>;

        expect(body.data.query).toBe('cat');
        expect(['PENDING', 'READY']).toContain(body.data.left.status);
        expect(['PENDING', 'READY']).toContain(body.data.right.status);
      });

    const feed = await waitForFeed('cat', (data) => {
      expect(data.left.status).toBe('READY');
      expect(data.right.status).toBe('READY');
      expect(data.items).toEqual([{ left: catItem, right: graffitiItem }]);
    });

    expect(feed.items).toHaveLength(1);
  });

  it('returns partial feed while one side is still pending', async () => {
    mockSearch('dog', [catItem]);
    mockSearch('dog graffiti', [graffitiItem], { delayMs: 250 });

    await postSearch('dog').expect(202);

    await waitForFeed('dog', (data) => {
      expect(data.left.status).toBe('READY');
      expect(data.right.status).toBe('PENDING');
      expect(data.items).toEqual([{ left: catItem, right: null }]);
    });
    await waitForReadyFeed('dog');
  });

  it('does not request upstream again for a fresh cached query', async () => {
    let upstreamCalls = 0;
    mockSearch('fresh', [catItem], { onCall: () => (upstreamCalls += 1) });
    mockSearch('fresh graffiti', [graffitiItem], {
      onCall: () => (upstreamCalls += 1),
    });

    await postSearch('fresh').expect(202);
    await waitForReadyFeed('fresh');

    await postSearch('fresh').expect(202);
    await waitForReadyFeed('fresh');

    expect(upstreamCalls).toBe(2);
  });

  it('refetches results older than the cache ttl', async () => {
    let upstreamCalls = 0;
    mockSearch('stale', [catItem], { onCall: () => (upstreamCalls += 1) });
    mockSearch('stale graffiti', [graffitiItem], {
      onCall: () => (upstreamCalls += 1),
    });

    await postSearch('stale').expect(202);
    await waitForReadyFeed('stale');

    const staleFetchedAt = new Date(Date.now() - 3601 * 1000);
    await e2e.prisma.searchResult.updateMany({
      where: { query: { in: ['stale', 'stale graffiti'] } },
      data: { fetchedAt: staleFetchedAt },
    });

    mockSearch('stale', [catItem], { onCall: () => (upstreamCalls += 1) });
    mockSearch('stale graffiti', [graffitiItem], {
      onCall: () => (upstreamCalls += 1),
    });

    await postSearch('stale').expect(202);
    await waitForReadyFeed('stale');

    expect(upstreamCalls).toBe(4);
  });

  it('deduplicates concurrent submit requests for the same query', async () => {
    let upstreamCalls = 0;
    mockSearch('parallel', [catItem], { onCall: () => (upstreamCalls += 1) });
    mockSearch('parallel graffiti', [graffitiItem], {
      onCall: () => (upstreamCalls += 1),
    });

    await Promise.all(
      Array.from({ length: 8 }, () => postSearch('parallel').expect(202)),
    );
    await waitForReadyFeed('parallel');

    expect(upstreamCalls).toBe(2);
  });

  it('retries 429 responses and stores the later successful result', async () => {
    const client = mockAgent.get(baseUrl);
    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'rate' } })
      .reply(429, { error: 'rate limited' }, { headers: { 'retry-after': '0' } });
    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'rate' } })
      .reply(429, { error: 'rate limited' }, { headers: { 'retry-after': '0' } });
    client
      .intercept({ method: 'GET', path: '/search', query: { q: 'rate' } })
      .reply(200, { items: [catItem] });
    mockSearch('rate graffiti', [graffitiItem]);

    await postSearch('rate').expect(202);

    await waitForFeed('rate', (data) => {
      expect(data.left.status).toBe('READY');
      expect(data.left.error).toBeNull();
      expect(data.items).toContainEqual(
        expect.objectContaining({ left: catItem }),
      );
    });
  });

  it('stores exhausted upstream failures and restarts them on the next submit', async () => {
    mockSearchFailure('fail');
    mockSearch('fail graffiti', [graffitiItem]);

    await postSearch('fail').expect(202);

    await waitForFeed('fail', (data) => {
      expect(data.left.status).toBe('FAILED');
      expect(data.left.error).toEqual(expect.any(String));
      expect(data.right.status).toBe('READY');
    });

    mockSearch('fail', [catItem]);

    await postSearch('fail')
      .expect(202)
      .expect((response) => {
        const body = response.body as SuccessEnvelope<SearchAcceptedData>;

        expect(body.data.left.status).toBe('PENDING');
      });

    await waitForFeed('fail', (data) => {
      expect(data.left.status).toBe('READY');
      expect(data.left.error).toBeNull();
      expect(data.items).toEqual([{ left: catItem, right: graffitiItem }]);
    });
  });

  it('zips different length result lists by max length with nulls', async () => {
    const extraCatItem = {
      url: 'https://cdn.example.test/cat-2.jpg',
      width: 640,
      height: 480,
      tags: ['cat', 'second'],
    };
    mockSearch('length', [catItem, extraCatItem]);
    mockSearch('length graffiti', [graffitiItem]);

    await postSearch('length').expect(202);

    await waitForFeed('length', (data) => {
      expect(data.left.status).toBe('READY');
      expect(data.right.status).toBe('READY');
      expect(data.items).toEqual([
        { left: catItem, right: graffitiItem },
        { left: extraCatItem, right: null },
      ]);
    });
  });

  function postSearch(query: string): request.Test {
    return request(server()).post('/api/searches').send({ query });
  }

  function getFeed(query: string): request.Test {
    return request(server()).get('/api/feed').query({ query });
  }

  function server(): Server {
    return e2e.app.getHttpServer() as Server;
  }

  function mockSearch(
    query: string,
    items: unknown[],
    options: { delayMs?: number; onCall?: () => void } = {},
  ): void {
    const interceptor = mockAgent
      .get(baseUrl)
      .intercept({ method: 'GET', path: '/search', query: { q: query } })
      .reply(() => {
        options.onCall?.();

        return { statusCode: 200, data: { items } };
      });

    if (options.delayMs) {
      interceptor.delay(options.delayMs);
    }
  }

  function mockSearchFailure(query: string): void {
    const client = mockAgent.get(baseUrl);

    for (let index = 0; index < 3; index += 1) {
      client
        .intercept({ method: 'GET', path: '/search', query: { q: query } })
        .reply(502, { error: 'bad gateway' });
    }
  }

  async function waitForReadyFeed(query: string): Promise<FeedData> {
    return waitForFeed(query, (data) => {
      expect(data.left.status).toBe('READY');
      expect(data.right.status).toBe('READY');
    });
  }

  async function waitForFeed(
    query: string,
    assertion: (data: FeedData) => void,
  ): Promise<FeedData> {
    let lastError: unknown;
    let lastData: FeedData | null = null;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await getFeed(query);
      const body = response.body as SuccessEnvelope<FeedData>;
      const data = body.data;
      lastData = data;

      try {
        assertion(data);
        return data;
      } catch (error) {
        lastError = error;
        await sleep(50);
      }
    }

    if (lastData) {
      throw new Error(
        `${lastError instanceof Error ? lastError.message : String(lastError)}\nLast feed: ${JSON.stringify(lastData)}`,
      );
    }

    throw lastError;
  }
});

interface FeedData {
  query: string;
  left: FeedSide;
  right: FeedSide;
  items: Array<{ left: SearchResultItem | null; right: SearchResultItem | null }>;
}

interface FeedSide {
  query: string;
  status: SearchStatus;
  fetchedAt: string | null;
  error: string | null;
}

interface SearchAcceptedData {
  query: string;
  left: AcceptedSide;
  right: AcceptedSide;
}

interface AcceptedSide {
  query: string;
  status: SearchStatus;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  error: null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
