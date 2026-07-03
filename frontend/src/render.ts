import { Feed, FeedSide, ImageItem } from './api';

export type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string; leftQuery: string; rightQuery: string }
  | { kind: 'feed'; feed: Feed }
  | { kind: 'error'; message: string };

interface RenderTargets {
  status: HTMLElement;
  feed: HTMLElement;
}

export function render(targets: RenderTargets, state: ViewState): void {
  targets.status.replaceChildren();
  targets.feed.replaceChildren();

  if (state.kind === 'idle') {
    targets.status.append(statusText('Enter a query to start.'));
    return;
  }

  if (state.kind === 'loading') {
    targets.status.append(statusText(`Loading ${state.query}`));
    targets.feed.append(
      renderPairShell(
        renderSkeletonSide(state.leftQuery),
        renderSkeletonSide(state.rightQuery),
      ),
    );
    return;
  }

  if (state.kind === 'error') {
    targets.status.append(statusText(state.message, 'error'));
    return;
  }

  const { feed } = state;
  targets.status.append(renderFeedStatus(feed));

  if (feed.items.length === 0) {
    targets.feed.append(
      renderPairShell(renderSidePlaceholder(feed.left), renderSidePlaceholder(feed.right)),
    );
    return;
  }

  for (const item of feed.items) {
    targets.feed.append(
      renderPairShell(
        item.left ? renderImageSide(feed.left, item.left) : renderSidePlaceholder(feed.left),
        item.right
          ? renderImageSide(feed.right, item.right)
          : renderSidePlaceholder(feed.right),
      ),
    );
  }
}

function renderFeedStatus(feed: Feed): HTMLElement {
  const element = document.createElement('div');
  element.className = 'feed-status';
  element.append(
    statusBadge(feed.left.query, feed.left.status),
    statusBadge(feed.right.query, feed.right.status),
  );
  return element;
}

function statusBadge(query: string, status: FeedSide['status']): HTMLElement {
  const element = document.createElement('span');
  element.className = `status-badge status-${status.toLowerCase()}`;
  element.textContent = `${query}: ${status}`;
  return element;
}

function renderPairShell(left: HTMLElement, right: HTMLElement): HTMLElement {
  const row = document.createElement('article');
  row.className = 'feed-item';
  row.append(left, right);
  return row;
}

function renderImageSide(side: FeedSide, item: ImageItem): HTMLElement {
  const column = renderSideBase(side.query);
  const image = document.createElement('img');
  image.className = 'feed-image';
  image.src = item.url;
  image.alt = item.tags.length > 0 ? item.tags.join(', ') : side.query;
  image.loading = 'lazy';
  image.width = item.width;
  image.height = item.height;

  column.append(image, renderTags(item.tags));
  return column;
}

function renderSidePlaceholder(side: FeedSide): HTMLElement {
  if (side.status === 'FAILED') {
    return renderFailedSide(side);
  }

  if (side.status === 'PENDING') {
    return renderSkeletonSide(side.query);
  }

  const column = renderSideBase(side.query);
  const empty = document.createElement('p');
  empty.className = 'empty-side';
  empty.textContent = 'No image';
  column.append(empty);
  return column;
}

function renderSkeletonSide(query: string): HTMLElement {
  const column = renderSideBase(query);
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton-card';
  skeleton.setAttribute('aria-label', 'Loading');
  column.append(skeleton);
  return column;
}

function renderFailedSide(side: FeedSide): HTMLElement {
  const column = renderSideBase(side.query);
  const error = document.createElement('p');
  error.className = 'side-error';
  error.textContent = side.error ?? 'Failed to load';
  column.append(error);
  return column;
}

function renderSideBase(query: string): HTMLElement {
  const column = document.createElement('section');
  column.className = 'feed-side';

  const title = document.createElement('h2');
  title.className = 'side-title';
  title.textContent = query;

  column.append(title);
  return column;
}

function renderTags(tags: string[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'tag-list';

  for (const tag of tags) {
    const item = document.createElement('li');
    item.className = 'tag';
    item.textContent = tag;
    list.append(item);
  }

  return list;
}

function statusText(message: string, tone: 'normal' | 'error' = 'normal'): HTMLElement {
  const element = document.createElement('p');
  element.className = tone === 'error' ? 'status-message status-message-error' : 'status-message';
  element.textContent = message;
  return element;
}
