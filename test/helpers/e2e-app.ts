import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppModule } from '../../src/app.module';
import { ValidationException } from '../../src/common/exceptions';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface E2eApp {
  app: INestApplication;
  container: StartedPostgreSqlContainer;
  prisma: PrismaService;
  stop(): Promise<void>;
}

export async function startE2eApp(): Promise<E2eApp> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.IMAGE_API_BASE_URL = 'https://service.test.elvetech.io';
  process.env.IMAGE_API_TOKEN = 'image-api-token';
  process.env.CACHE_TTL_SECONDS = '3600';
  process.env.UPSTREAM_TIMEOUT_MS = '10000';
  process.env.UPSTREAM_RETRY_ATTEMPTS = '3';
  process.env.PENDING_STALE_SECONDS = '120';
  process.env.LOG_LEVEL = 'silent';

  await applyMigration();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: () => new ValidationException(),
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0);

  return {
    app,
    container,
    prisma: app.get(PrismaService),
    async stop(): Promise<void> {
      await app.close();
      await container.stop();
    },
  };
}

async function applyMigration(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
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
  } finally {
    await prisma.onModuleDestroy();
  }
}
