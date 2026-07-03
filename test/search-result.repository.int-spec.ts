import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppConfig } from '../src/config/config.schema';
import { Prisma } from '../src/generated/prisma/client';
import { SearchStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SearchResultItem,
  SearchResultRepository,
} from '../src/feed/search-result.repository';

function createConfig(): ConfigService<AppConfig, true> {
  const config: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    IMAGE_API_BASE_URL: 'https://service.test.elvetech.io',
    IMAGE_API_TOKEN: 'image-api-token',
    CACHE_TTL_SECONDS: 3600,
    UPSTREAM_TIMEOUT_MS: 60000,
    UPSTREAM_RETRY_ATTEMPTS: 3,
    PENDING_STALE_SECONDS: 120,
    LOG_LEVEL: 'silent',
  };

  return {
    getOrThrow: <K extends keyof AppConfig>(key: K): AppConfig[K] =>
      config[key],
  } as ConfigService<AppConfig, true>;
}

async function applyMigration(prisma: PrismaService): Promise<void> {
  const migrationSql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260703112846_init/migration.sql'),
    'utf8',
  );

  for (const statement of migrationSql.split(';')) {
    const trimmed = statement.trim();

    if (trimmed) {
      await prisma.$executeRawUnsafe(trimmed);
    }
  }
}

describe('SearchResultRepository', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let repository: SearchResultRepository;

  const imageItems: SearchResultItem[] = [
    {
      url: 'https://cdn.example.test/cat.jpg',
      width: 1200,
      height: 800,
      tags: ['cat', 'cute'],
    },
  ];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    process.env.DATABASE_URL = container.getConnectionUri();

    prisma = new PrismaService();
    await prisma.onModuleInit();
    await applyMigration(prisma);

    repository = new SearchResultRepository(prisma, createConfig());
  }, 120000);

  afterEach(async () => {
    await prisma.searchResult.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await container.stop();
  });

  it('upserts a missing query as PENDING', async () => {
    await expect(repository.tryMarkPending('cat')).resolves.toBe(true);

    const row = await prisma.searchResult.findUniqueOrThrow({
      where: { query: 'cat' },
    });

    expect(row.status).toBe(SearchStatus.PENDING);
    expect(row.items).toEqual([]);
    expect(row.error).toBeNull();
    expect(row.fetchedAt).toBeNull();
  });

  it('does not mark a fresh READY result as PENDING', async () => {
    await prisma.searchResult.create({
      data: {
        query: 'cat',
        status: SearchStatus.READY,
        items: imageItems as unknown as Prisma.InputJsonValue,
        fetchedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });

    await expect(repository.tryMarkPending('cat')).resolves.toBe(false);

    const row = await prisma.searchResult.findUniqueOrThrow({
      where: { query: 'cat' },
    });
    expect(row.status).toBe(SearchStatus.READY);
  });

  it('marks an expired READY result as PENDING', async () => {
    await prisma.searchResult.create({
      data: {
        query: 'cat',
        status: SearchStatus.READY,
        items: imageItems as unknown as Prisma.InputJsonValue,
        fetchedAt: new Date(Date.now() - 3601 * 1000),
      },
    });

    await expect(repository.tryMarkPending('cat')).resolves.toBe(true);

    const row = await prisma.searchResult.findUniqueOrThrow({
      where: { query: 'cat' },
    });
    expect(row.status).toBe(SearchStatus.PENDING);
    expect(row.items).toEqual([]);
    expect(row.error).toBeNull();
    expect(row.fetchedAt).toBeNull();
  });

  it('marks a FAILED result as PENDING', async () => {
    await prisma.searchResult.create({
      data: {
        query: 'cat',
        status: SearchStatus.FAILED,
        items: [],
        error: 'upstream failed',
      },
    });

    await expect(repository.tryMarkPending('cat')).resolves.toBe(true);

    const row = await prisma.searchResult.findUniqueOrThrow({
      where: { query: 'cat' },
    });
    expect(row.status).toBe(SearchStatus.PENDING);
    expect(row.error).toBeNull();
  });

  it('does not mark a recent PENDING result again', async () => {
    await prisma.searchResult.create({
      data: {
        query: 'cat',
        status: SearchStatus.PENDING,
        items: [],
      },
    });

    await expect(repository.tryMarkPending('cat')).resolves.toBe(false);
  });

  it('marks a stale PENDING result as PENDING again', async () => {
    await prisma.searchResult.create({
      data: {
        query: 'cat',
        status: SearchStatus.PENDING,
        items: [],
      },
    });
    const staleUpdatedAt = new Date(Date.now() - 121 * 1000);

    await prisma.$executeRaw`
      UPDATE search_results
      SET "updatedAt" = ${staleUpdatedAt}
      WHERE query = 'cat'
    `;

    await expect(repository.tryMarkPending('cat')).resolves.toBe(true);

    const row = await prisma.searchResult.findUniqueOrThrow({
      where: { query: 'cat' },
    });
    expect(row.updatedAt.getTime()).toBeGreaterThan(staleUpdatedAt.getTime());
  });

  it('allows exactly one concurrent tryMarkPending for the same missing query', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.tryMarkPending('cat')),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(prisma.searchResult.count({ where: { query: 'cat' } })).resolves.toBe(
      1,
    );
  });

  it('marks a result as READY with items and fetchedAt', async () => {
    await repository.tryMarkPending('cat');

    const row = await repository.markReady('cat', imageItems);

    expect(row.status).toBe(SearchStatus.READY);
    expect(row.items).toEqual(imageItems);
    expect(row.error).toBeNull();
    expect(row.fetchedAt).toBeInstanceOf(Date);
  });

  it('marks a result as FAILED with an error message', async () => {
    await repository.tryMarkPending('cat');

    const row = await repository.markFailed('cat', 'upstream failed');

    expect(row.status).toBe(SearchStatus.FAILED);
    expect(row.items).toEqual([]);
    expect(row.error).toBe('upstream failed');
    expect(row.fetchedAt).toBeNull();
  });

  it('finds two search results by their queries', async () => {
    await repository.tryMarkPending('cat');
    await repository.markReady('cat', imageItems);
    await repository.tryMarkPending('cat graffiti');

    await expect(repository.findByQueries(['cat', 'cat graffiti'])).resolves.toEqual(
      {
        left: expect.objectContaining({
          query: 'cat',
          status: SearchStatus.READY,
          items: imageItems,
        }),
        right: expect.objectContaining({
          query: 'cat graffiti',
          status: SearchStatus.PENDING,
          items: [],
        }),
      },
    );
  });
});
