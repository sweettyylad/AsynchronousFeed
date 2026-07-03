import { ApiError, getFeed, submitSearch } from './api';
import { render } from './render';
import './styles.css';

const pollIntervalMs = 2000;

const form = requiredElement<HTMLFormElement>('#search-form');
const input = requiredElement<HTMLInputElement>('#query-input');
const statusRoot = requiredElement<HTMLElement>('#status-region');
const feedRoot = requiredElement<HTMLElement>('#feed-root');

let pollTimer: number | null = null;
let requestVersion = 0;

const targets = {
  status: statusRoot,
  feed: feedRoot,
};

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void startSearch(input.value);
});

window.addEventListener('popstate', () => {
  const query = getQueryFromUrl();
  if (query) {
    input.value = query;
    void loadFromUrl(query);
  } else {
    stopPolling();
    render(targets, { kind: 'idle' });
  }
});

const initialQuery = getQueryFromUrl();

if (initialQuery) {
  input.value = initialQuery;
  void loadFromUrl(initialQuery);
} else {
  render(targets, { kind: 'idle' });
}

async function startSearch(rawQuery: string): Promise<void> {
  const query = rawQuery.trim();

  if (!query) {
    render(targets, { kind: 'error', message: 'Query is required.' });
    return;
  }

  const version = nextRequestVersion();
  render(targets, {
    kind: 'loading',
    query,
    leftQuery: query,
    rightQuery: `${query} graffiti`,
  });

  try {
    const accepted = await submitSearch(query);

    if (!isCurrent(version)) {
      return;
    }

    updateUrl(accepted.query);
    input.value = accepted.query;
    await loadFeed(accepted.query, version);
  } catch (error) {
    if (isCurrent(version)) {
      render(targets, { kind: 'error', message: getErrorMessage(error) });
    }
  }
}

async function loadFromUrl(query: string): Promise<void> {
  const version = nextRequestVersion();
  render(targets, {
    kind: 'loading',
    query,
    leftQuery: query,
    rightQuery: `${query} graffiti`,
  });

  try {
    await loadFeed(query, version);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'FEED_NOT_FOUND') {
      await startSearch(query);
      return;
    }

    if (isCurrent(version)) {
      render(targets, { kind: 'error', message: getErrorMessage(error) });
    }
  }
}

async function loadFeed(query: string, version: number): Promise<void> {
  const feed = await getFeed(query);

  if (!isCurrent(version)) {
    return;
  }

  render(targets, { kind: 'feed', feed });

  if (feed.left.status === 'PENDING' || feed.right.status === 'PENDING') {
    schedulePoll(query, version);
  } else {
    stopPolling();
  }
}

function schedulePoll(query: string, version: number): void {
  stopPolling();

  pollTimer = window.setTimeout(() => {
    void loadFeed(query, version).catch((error: unknown) => {
      if (isCurrent(version)) {
        render(targets, { kind: 'error', message: getErrorMessage(error) });
      }
    });
  }, pollIntervalMs);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function nextRequestVersion(): number {
  stopPolling();
  requestVersion += 1;
  return requestVersion;
}

function isCurrent(version: number): boolean {
  return version === requestVersion;
}

function updateUrl(query: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('q', query);
  window.history.pushState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
}

function getQueryFromUrl(): string | null {
  const query = new URLSearchParams(window.location.search).get('q')?.trim();
  return query ? query : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Request failed.';
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}
