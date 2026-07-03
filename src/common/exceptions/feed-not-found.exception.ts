import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

export class FeedNotFoundException extends AppException {
  constructor(message = 'Feed not found') {
    super('FEED_NOT_FOUND', HttpStatus.NOT_FOUND, message);
  }
}
