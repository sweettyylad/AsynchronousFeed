import { describe, expect, it, jest } from '@jest/globals';

import { FeedNotFoundException } from '../common/exceptions';
import { SearchStatus } from '../generated/prisma/enums';
import { ImageProviderService } from '../image-provider/image-provider.service';
import {
  SearchResultItem,
  SearchResultRecord,
  SearchResultRepository,
} from './search-result.repository';
import { FeedService } from './feed.service';

function createRecord(
  query: string,
  status: SearchStatus,
  items: SearchResultItem[] = [],
): SearchResultRecord {
  return {
    id: `${query}-id`,
    query,
    status,
    items,
    error: status === SearchStatus.FAILED ? 'failed' : null,
    fetchedAt: status === SearchStatus.READY ? new Date('2026-07-03T10:00:00Z') : null,
    createdAt: new Date('2026-07-03T09:00:00Z'),
    updatedAt: new Date('2026-07-03T10:00:00Z'),
  };
}

function createRepositoryMock(): jest.Mocked<
  Pick<
    SearchResultRepository,
    'tryMarkPending' | 'markReady' | 'markFailed' | 'findByQueries'
  >
> {
  return {
    tryMarkPending: jest.fn(),
    markReady: jest.fn(),
    markFailed: jest.fn(),
    findByQueries: jest.fn(),
  };
}

function createProviderMock(): jest.Mocked<Pick<ImageProviderService, 'search'>> {
  return {
    search: jest.fn(),
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('FeedService', () => {
  const leftItem: SearchResultItem = {
    url: 'https://cdn.example.test/cat.jpg',
    width: 1200,
    height: 800,
    tags: ['cat'],
  };
  const rightItem: SearchResultItem = {
    url: 'https://cdn.example.test/cat-graffiti.jpg',
    width: 900,
    height: 600,
    tags: ['cat', 'graffiti'],
  };

  it('submit starts background fetch only for stale sides', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    repository.tryMarkPending
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    repository.findByQueries.mockResolvedValue({
      left: createRecord('cat', SearchStatus.READY, [leftItem]),
      right: createRecord('cat graffiti', SearchStatus.PENDING),
    });
    provider.search.mockResolvedValue([rightItem]);

    const result = await new FeedService(
      repository as unknown as SearchResultRepository,
      provider as unknown as ImageProviderService,
    ).submitSearch('  Cat  ');
    await flushPromises();

    expect(repository.tryMarkPending).toHaveBeenCalledWith('cat');
    expect(repository.tryMarkPending).toHaveBeenCalledWith('cat graffiti');
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith('cat graffiti');
    expect(repository.markReady).toHaveBeenCalledWith('cat graffiti', [rightItem]);
    expect(result).toEqual({
      query: 'cat',
      left: { query: 'cat', status: SearchStatus.READY },
      right: { query: 'cat graffiti', status: SearchStatus.PENDING },
    });
  });

  it('stores FAILED when background fetch rejects without rejecting submit', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    repository.tryMarkPending
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    repository.findByQueries.mockResolvedValue({
      left: createRecord('cat', SearchStatus.READY, [leftItem]),
      right: createRecord('cat graffiti', SearchStatus.PENDING),
    });
    provider.search.mockRejectedValue(new Error('upstream failed'));

    await expect(
      new FeedService(
        repository as unknown as SearchResultRepository,
        provider as unknown as ImageProviderService,
      ).submitSearch('cat'),
    ).resolves.toEqual({
      query: 'cat',
      left: { query: 'cat', status: SearchStatus.READY },
      right: { query: 'cat graffiti', status: SearchStatus.PENDING },
    });
    await flushPromises();

    expect(repository.markFailed).toHaveBeenCalledWith(
      'cat graffiti',
      'upstream failed',
    );
  });

  it('zips equal-length left and right item lists', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    const secondLeft = { ...leftItem, url: 'https://cdn.example.test/cat-2.jpg' };
    const secondRight = {
      ...rightItem,
      url: 'https://cdn.example.test/cat-graffiti-2.jpg',
    };
    repository.findByQueries.mockResolvedValue({
      left: createRecord('cat', SearchStatus.READY, [leftItem, secondLeft]),
      right: createRecord('cat graffiti', SearchStatus.READY, [
        rightItem,
        secondRight,
      ]),
    });

    await expect(
      new FeedService(
        repository as unknown as SearchResultRepository,
        provider as unknown as ImageProviderService,
      ).getFeed('cat'),
    ).resolves.toMatchObject({
      items: [
        { left: leftItem, right: rightItem },
        { left: secondLeft, right: secondRight },
      ],
    });
  });

  it('zips different-length lists with nulls on the missing side', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    repository.findByQueries.mockResolvedValue({
      left: createRecord('cat', SearchStatus.READY, [leftItem]),
      right: createRecord('cat graffiti', SearchStatus.READY, [
        rightItem,
        { ...rightItem, url: 'https://cdn.example.test/cat-graffiti-2.jpg' },
      ]),
    });

    await expect(
      new FeedService(
        repository as unknown as SearchResultRepository,
        provider as unknown as ImageProviderService,
      ).getFeed('cat'),
    ).resolves.toMatchObject({
      items: [
        { left: leftItem, right: rightItem },
        {
          left: null,
          right: { ...rightItem, url: 'https://cdn.example.test/cat-graffiti-2.jpg' },
        },
      ],
    });
  });

  it('returns an empty zipped list when both sides have no items', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    repository.findByQueries.mockResolvedValue({
      left: createRecord('cat', SearchStatus.READY),
      right: createRecord('cat graffiti', SearchStatus.READY),
    });

    await expect(
      new FeedService(
        repository as unknown as SearchResultRepository,
        provider as unknown as ImageProviderService,
      ).getFeed('cat'),
    ).resolves.toMatchObject({ items: [] });
  });

  it('throws FeedNotFoundException for an unknown query', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    repository.findByQueries.mockResolvedValue({ left: null, right: null });

    await expect(
      new FeedService(
        repository as unknown as SearchResultRepository,
        provider as unknown as ImageProviderService,
      ).getFeed('cat'),
    ).rejects.toBeInstanceOf(FeedNotFoundException);
  });

  it('never calls provider while reading a feed', async () => {
    const repository = createRepositoryMock();
    const provider = createProviderMock();
    repository.findByQueries.mockResolvedValue({
      left: createRecord('cat', SearchStatus.PENDING),
      right: createRecord('cat graffiti', SearchStatus.FAILED),
    });

    await new FeedService(
      repository as unknown as SearchResultRepository,
      provider as unknown as ImageProviderService,
    ).getFeed('cat');

    expect(provider.search).not.toHaveBeenCalled();
  });
});
