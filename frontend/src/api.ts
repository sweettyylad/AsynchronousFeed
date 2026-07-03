export type SearchStatus = 'PENDING' | 'READY' | 'FAILED';

export interface ImageItem {
  url: string;
  width: number;
  height: number;
  tags: string[];
}

export interface FeedSide {
  query: string;
  status: SearchStatus;
  fetchedAt: string | null;
  error: string | null;
}

export interface FeedItemPair {
  left: ImageItem | null;
  right: ImageItem | null;
}

export interface Feed {
  query: string;
  left: FeedSide;
  right: FeedSide;
  items: FeedItemPair[];
}

export interface SearchAccepted {
  query: string;
  left: Pick<FeedSide, 'query' | 'status'>;
  right: Pick<FeedSide, 'query' | 'status'>;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  error: null;
}

interface ErrorEnvelope {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
  };
}

type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function submitSearch(query: string): Promise<SearchAccepted> {
  return requestJson<SearchAccepted>('/api/searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

export async function getFeed(query: string): Promise<Feed> {
  const params = new URLSearchParams({ query });

  return requestJson<Feed>(`/api/feed?${params.toString()}`);
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (!envelope.success) {
    throw new ApiError(envelope.error.code, envelope.error.message);
  }

  return envelope.data;
}
