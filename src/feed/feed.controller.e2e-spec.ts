import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { Server } from 'node:http';

import { ValidationException } from '../common/exceptions';
import { FeedNotFoundException } from '../common/exceptions/feed-not-found.exception';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from '../common/interceptors/response-envelope.interceptor';
import { SearchStatus } from '../generated/prisma/enums';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

describe('FeedController', () => {
  let app: INestApplication;
  let feedService: {
    submitSearch: jest.MockedFunction<FeedService['submitSearch']>;
    getFeed: jest.MockedFunction<FeedService['getFeed']>;
  };

  beforeAll(async () => {
    feedService = {
      submitSearch: jest.fn<FeedService['submitSearch']>(),
      getFeed: jest.fn<FeedService['getFeed']>(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [{ provide: FeedService, useValue: feedService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: () => new ValidationException(),
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 202 envelope for valid POST /api/searches', async () => {
    feedService.submitSearch.mockResolvedValue({
      query: 'cat',
      left: { query: 'cat', status: SearchStatus.READY },
      right: { query: 'cat graffiti', status: SearchStatus.PENDING },
    });

    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/searches')
      .send({ query: 'Cat' })
      .expect(202)
      .expect({
        success: true,
        data: {
          query: 'cat',
          left: { query: 'cat', status: 'READY' },
          right: { query: 'cat graffiti', status: 'PENDING' },
        },
        error: null,
      });

    expect(feedService.submitSearch).toHaveBeenCalledWith('Cat');
  });

  it('returns VALIDATION_ERROR for empty POST query', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/searches')
      .send({ query: '' })
      .expect(400)
      .expect({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      });
  });

  it('returns VALIDATION_ERROR for GET /api/feed without query', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .get('/api/feed')
      .expect(400)
      .expect({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      });
  });

  it('returns FEED_NOT_FOUND for unknown GET /api/feed query', async () => {
    feedService.getFeed.mockRejectedValue(new FeedNotFoundException());

    const server = app.getHttpServer() as Server;

    await request(server)
      .get('/api/feed')
      .query({ query: 'missing' })
      .expect(404)
      .expect({
        success: false,
        data: null,
        error: {
          code: 'FEED_NOT_FOUND',
          message: 'Feed not found',
        },
      });

    expect(feedService.getFeed).toHaveBeenCalledWith('missing');
  });
});
