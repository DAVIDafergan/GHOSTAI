import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Catches everything, not just HttpException. Nest's own default filter
 * already avoids leaking stack traces for uncaught errors, but that's
 * implicit framework behavior this project doesn't control - being
 * explicit here means the "never leak internals" guarantee is visible,
 * tested, and won't silently change on a Nest version bump.
 *
 * HttpException (NotFoundException, UnauthorizedException, the
 * ValidationPipe's BadRequestException, ThrottlerException, etc.) already
 * carries a deliberately client-safe status+message - pass those through
 * as-is. Anything else (a raw Error, a Prisma error, a TypeError from a
 * bug) is an unexpected failure: log the full error with its stack
 * server-side for debugging, but the client only ever gets a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
