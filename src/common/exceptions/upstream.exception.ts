import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

export abstract class UpstreamException extends AppException {
  protected constructor(message: string) {
    super('UPSTREAM_ERROR', HttpStatus.INTERNAL_SERVER_ERROR, message);
  }
}

export class UpstreamTimeoutException extends UpstreamException {
  constructor(message = 'Upstream service did not respond in time') {
    super(message);
    this.name = 'UpstreamTimeoutException';
  }
}

export class UpstreamRateLimitException extends UpstreamException {
  constructor(message = 'Upstream rate limit exceeded') {
    super(message);
    this.name = 'UpstreamRateLimitException';
  }
}

export class UpstreamBadResponseException extends UpstreamException {
  constructor(message = 'Upstream service returned an invalid response') {
    super(message);
    this.name = 'UpstreamBadResponseException';
  }
}
