import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/config.schema';
import { Prisma, SearchResult } from '../generated/prisma/client';
import { SearchStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchResultItem {
  url: string;
  width: number;
  height: number;
  tags: string[];
}

export interface SearchResultRecord {
  id: string;
  query: string;
  status: SearchStatus;
  items: SearchResultItem[];
  error: string | null;
  fetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResultPair {
  left: SearchResultRecord | null;
  right: SearchResultRecord | null;
}

@Injectable()
export class SearchResultRepository {
  private readonly cacheTtlSeconds: number;
  private readonly pendingStaleSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cacheTtlSeconds = config.getOrThrow('CACHE_TTL_SECONDS');
    this.pendingStaleSeconds = config.getOrThrow('PENDING_STALE_SECONDS');
  }

  async tryMarkPending(query: string): Promise<boolean> {
    try {
      await this.prisma.searchResult.create({
        data: {
          query,
          status: SearchStatus.PENDING,
          items: [],
          error: null,
          fetchedAt: null,
        },
      });

      return true;
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
    }

    const now = new Date();
    const staleFetchedAt = new Date(
      now.getTime() - this.cacheTtlSeconds * 1000,
    );
    const stalePendingUpdatedAt = new Date(
      now.getTime() - this.pendingStaleSeconds * 1000,
    );

    const result = await this.prisma.searchResult.updateMany({
      where: {
        query,
        OR: [
          {
            status: SearchStatus.READY,
            OR: [{ fetchedAt: null }, { fetchedAt: { lte: staleFetchedAt } }],
          },
          { status: SearchStatus.FAILED },
          {
            status: SearchStatus.PENDING,
            updatedAt: { lte: stalePendingUpdatedAt },
          },
        ],
      },
      data: {
        status: SearchStatus.PENDING,
        items: [],
        error: null,
        fetchedAt: null,
      },
    });

    return result.count === 1;
  }

  async markReady(
    query: string,
    items: SearchResultItem[],
  ): Promise<SearchResultRecord> {
    const row = await this.prisma.searchResult.update({
      where: { query },
      data: {
        status: SearchStatus.READY,
        items: items as unknown as Prisma.InputJsonValue,
        error: null,
        fetchedAt: new Date(),
      },
    });

    return this.toRecord(row);
  }

  async markFailed(
    query: string,
    error: string,
  ): Promise<SearchResultRecord> {
    const row = await this.prisma.searchResult.update({
      where: { query },
      data: {
        status: SearchStatus.FAILED,
        items: [],
        error,
        fetchedAt: null,
      },
    });

    return this.toRecord(row);
  }

  async findByQueries(queries: readonly [string, string]): Promise<SearchResultPair> {
    const rows = await this.prisma.searchResult.findMany({
      where: { query: { in: [...queries] } },
    });
    const rowsByQuery = new Map(rows.map((row) => [row.query, this.toRecord(row)]));

    return {
      left: rowsByQuery.get(queries[0]) ?? null,
      right: rowsByQuery.get(queries[1]) ?? null,
    };
  }

  private toRecord(row: SearchResult): SearchResultRecord {
    return {
      ...row,
      items: row.items as unknown as SearchResultItem[],
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
