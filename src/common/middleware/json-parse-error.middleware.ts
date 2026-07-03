import { HttpStatus } from '@nestjs/common';

interface HttpResponse {
  status(statusCode: number): {
    json(body: ErrorEnvelope): void;
  };
}

interface ErrorEnvelope {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
  };
}

export function jsonParseErrorMiddleware(
  error: unknown,
  _request: unknown,
  response: HttpResponse,
  next: (error: unknown) => void,
): void {
  if (!isJsonParseError(error)) {
    next(error);
    return;
  }

  response.status(HttpStatus.BAD_REQUEST).json({
    success: false,
    data: null,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid JSON body',
    },
  });
}

function isJsonParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  if (!('status' in error) || error.status !== HttpStatus.BAD_REQUEST) {
    return false;
  }

  return 'body' in error;
}
