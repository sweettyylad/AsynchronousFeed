import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

export class ValidationException extends AppException {
  constructor(message = 'Validation failed') {
    super('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, message);
  }
}
