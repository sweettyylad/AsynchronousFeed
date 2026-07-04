const retryDelaysMs = [750, 1500] as const;

export function attachImageRetry(image: HTMLImageElement, originalUrl: string): void {
  let retryIndex = 0;

  image.addEventListener('error', () => {
    const delayMs = retryDelaysMs[retryIndex];

    if (delayMs === undefined) {
      image.classList.add('feed-image--failed');
      return;
    }

    retryIndex += 1;

    window.setTimeout(() => {
      image.src = withImageRetryParam(originalUrl, retryIndex);
    }, delayMs);
  });
}

export function withImageRetryParam(url: string, retry: number): string {
  const parsed = new URL(url, getBaseUrl());
  parsed.searchParams.set('retry', String(retry));
  return parsed.toString();
}

function getBaseUrl(): string {
  return typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
}
