import { Injectable } from '@nestjs/common';

import { FeedNotFoundException } from '../common/exceptions';
import { SearchStatus } from '../generated/prisma/enums';
import { ImageProviderService } from '../image-provider/image-provider.service';
import {
  SearchResultItem,
  SearchResultRecord,
  SearchResultRepository,
} from './search-result.repository';
import { buildGraffitiQuery, normalizeQuery } from './query.util';

interface SearchSideAccepted {
  query: string;
  status: SearchStatus;
}

export interface SearchAccepted {
  query: string;
  left: SearchSideAccepted;
  right: SearchSideAccepted;
}

interface FeedSide {
  query: string;
  status: SearchStatus;
  fetchedAt: Date | null;
  error: string | null;
}

interface FeedItemPair {
  left: SearchResultItem | null;
  right: SearchResultItem | null;
}

export interface Feed {
  query: string;
  left: FeedSide;
  right: FeedSide;
  items: FeedItemPair[];
}

@Injectable()
export class FeedService {
  constructor(
    private readonly repository: SearchResultRepository,
    private readonly provider: ImageProviderService,
  ) {}

  async submitSearch(rawQuery: string): Promise<SearchAccepted> {
    const query = normalizeQuery(rawQuery);
    const rightQuery = buildGraffitiQuery(query);

    const [leftStarted, rightStarted] = await Promise.all([
      this.repository.tryMarkPending(query),
      this.repository.tryMarkPending(rightQuery),
    ]);

    if (leftStarted) {
      void this.fetchAndStore(query);
    }

    if (rightStarted) {
      void this.fetchAndStore(rightQuery);
    }

    const pair = await this.repository.findByQueries([query, rightQuery]);

    return {
      query,
      left: this.toAcceptedSide(query, pair.left, leftStarted),
      right: this.toAcceptedSide(rightQuery, pair.right, rightStarted),
    };
  }

  async getFeed(rawQuery: string): Promise<Feed> {
    const query = normalizeQuery(rawQuery);
    const rightQuery = buildGraffitiQuery(query);
    const pair = await this.repository.findByQueries([query, rightQuery]);

    if (!pair.left && !pair.right) {
      throw new FeedNotFoundException();
    }

    return {
      query,
      left: this.toFeedSide(query, pair.left),
      right: this.toFeedSide(rightQuery, pair.right),
      items: this.zipItems(pair.left, pair.right),
    };
  }

  private async fetchAndStore(query: string): Promise<void> {
    try {
      const items = await this.provider.search(query);
      await this.repository.markReady(query, items);
    } catch (error) {
      try {
        await this.repository.markFailed(query, this.getErrorMessage(error));
      } catch {
        // Background fetch errors must not escape into an unhandled rejection.
      }
    }
  }

  private toAcceptedSide(
    query: string,
    record: SearchResultRecord | null,
    started: boolean,
  ): SearchSideAccepted {
    return {
      query,
      status: started ? SearchStatus.PENDING : this.getRecordStatus(record),
    };
  }

  private toFeedSide(
    query: string,
    record: SearchResultRecord | null,
  ): FeedSide {
    return {
      query,
      status: this.getRecordStatus(record),
      fetchedAt: record?.fetchedAt ?? null,
      error: record?.error ?? null,
    };
  }

  private getRecordStatus(record: SearchResultRecord | null): SearchStatus {
    return record?.status ?? SearchStatus.PENDING;
  }

  private zipItems(
    left: SearchResultRecord | null,
    right: SearchResultRecord | null,
  ): FeedItemPair[] {
    const leftItems = left?.status === SearchStatus.READY ? left.items : [];
    const rightItems = right?.status === SearchStatus.READY ? right.items : [];
    const length = Math.max(leftItems.length, rightItems.length);

    return Array.from({ length }, (_, index) => ({
      left: leftItems[index] ?? null,
      right: rightItems[index] ?? null,
    }));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Upstream request failed';
  }
}
