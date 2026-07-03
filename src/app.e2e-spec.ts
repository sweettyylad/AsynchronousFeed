import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { Server } from 'node:http';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { PrismaService } from './prisma/prisma.service';

describe('App skeleton', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      'postgresql://app:app@localhost:5432/image_feed';
    process.env.IMAGE_API_TOKEN = 'image-api-token';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ ping: jest.fn<() => Promise<void>>().mockResolvedValue() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps GET /health in a success envelope', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .get('/health')
      .expect(200)
      .expect({
        success: true,
        data: { status: 'ok' },
        error: null,
      });
  });

  it('wraps unknown routes in an error envelope', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .get('/missing')
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual({
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: expect.any(String),
          },
        });
      });
  });
});
