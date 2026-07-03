import { HttpStatus } from '@nestjs/common';

export abstract class AppException extends Error {
  protected constructor(
    public readonly code: string,
    public readonly httpStatus: HttpStatus,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
