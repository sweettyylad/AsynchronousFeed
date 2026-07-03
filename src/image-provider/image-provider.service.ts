import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetch } from 'undici';

import {
  UpstreamBadResponseException,
  UpstreamRateLimitException,
  UpstreamTimeoutException,
} from '../common/exceptions';
import { AppConfig } from '../config/config.schema';
import { ImageItem, imageSearchResponseSchema } from './image-provider.schemas';

const BASE_BACKOFF_MS = 1000;
const MAX_JITTER_MS = 100;

@Injectable()
export class ImageProviderService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.baseUrl = this.config.getOrThrow('IMAGE_API_BASE_URL');
    this.token = this.config.getOrThrow('IMAGE_API_TOKEN');
    this.timeoutMs = this.config.getOrThrow('UPSTREAM_TIMEOUT_MS');
    this.maxAttempts = this.config.getOrThrow('UPSTREAM_RETRY_ATTEMPTS');
  }

  async search(query: string): Promise<ImageItem[]> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.fetchOnce(query);

      if (response.ok) {
        return this.parseItems(response);
      }

      if (response.status === 429) {
        if (attempt === this.maxAttempts) {
          throw new UpstreamRateLimitException();
        }

        await this.wait(this.getRetryDelayMs(response, attempt));
        continue;
      }

      if (response.status >= 500) {
        if (attempt === this.maxAttempts) {
          throw new UpstreamBadResponseException();
        }

        await this.wait(this.getBackoffDelayMs(attempt));
        continue;
      }

      throw new UpstreamBadResponseException();
    }

    throw new UpstreamBadResponseException();
  }

  private async fetchOnce(query: string): Promise<Response> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Token': this.token,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new UpstreamTimeoutException();
      }

      throw new UpstreamBadResponseException();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseItems(response: Response): Promise<ImageItem[]> {
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new UpstreamBadResponseException();
    }

    const parsed = imageSearchResponseSchema.safeParse(body);

    if (!parsed.success) {
      throw new UpstreamBadResponseException();
    }

    return parsed.data.items;
  }

  private getRetryDelayMs(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = this.parseRetryAfterMs(retryAfter);

    return retryAfterMs ?? this.getBackoffDelayMs(attempt);
  }

  private parseRetryAfterMs(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const seconds = Number(value);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const dateMs = Date.parse(value);

    if (Number.isNaN(dateMs)) {
      return null;
    }

    return Math.max(0, dateMs - Date.now());
  }

  private getBackoffDelayMs(attempt: number): number {
    const exponentialDelay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * MAX_JITTER_MS);

    return exponentialDelay + jitter;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private isAbortError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError'
    );
  }
}
