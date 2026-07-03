import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { AppException } from '../exceptions';

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

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const { status, code, message } = this.toErrorResponse(exception);

    if (!(exception instanceof AppException) && status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorEnvelope = {
      success: false,
      data: null,
      error: { code, message },
    };

    response.status(status).json(body);
  }

  private toErrorResponse(exception: unknown): {
    status: number;
    code: string;
    message: string;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = this.extractMessage(response, exception.message);

      if (status === 400 && this.isJsonParseMessage(message)) {
        return {
          status,
          code: 'VALIDATION_ERROR',
          message: 'Invalid JSON body',
        };
      }

      return {
        status,
        code: this.mapHttpStatusToCode(status),
        message,
      };
    }

    if (this.isBodyParserSyntaxError(exception)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON body',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }

  private mapHttpStatusToCode(status: number): string {
    if (status === 404) {
      return 'NOT_FOUND';
    }

    if (status === 400) {
      return 'VALIDATION_ERROR';
    }

    return `HTTP_${status}`;
  }

  private extractMessage(response: string | object, fallback: string): string {
    if (typeof response === 'string') {
      return response;
    }

    if ('message' in response) {
      const message = response.message;

      if (Array.isArray(message)) {
        return message.join('; ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return fallback;
  }

  private isBodyParserSyntaxError(exception: unknown): boolean {
    if (!(exception instanceof SyntaxError)) {
      return false;
    }

    if (!('status' in exception)) {
      return false;
    }

    return exception.status === HttpStatus.BAD_REQUEST;
  }

  private isJsonParseMessage(message: string): boolean {
    return message.toLowerCase().includes('json');
  }
}
