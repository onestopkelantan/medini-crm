import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError, ApiErrorBody } from './errors';
import { getCorrelationId } from '../correlation/correlation';

/**
 * Global exception filter → standard error envelope. Stack traces and secrets
 * are never sent to the client; unknown errors become a generic 500 with only
 * a correlationId for support lookup.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = getCorrelationId();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let fieldErrors: Record<string, string[]> | undefined;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.expose ? exception.message : 'An unexpected error occurred';
      fieldErrors = exception.fieldErrors;
      /* Gated actions may carry a machine-readable reason even though the
       * message itself is already safe to show. Kept OUT of `message` so the
       * message stays user-facing prose and the client can branch on the code
       * (e.g. a safety block offers a specific next step). */
      if (exception.details) details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = exception.name.replace(/Exception$/, '').replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '') || 'HTTP_ERROR';
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const m = (body as { message?: unknown }).message;
        if (Array.isArray(m)) {
          message = 'Validation failed';
          fieldErrors = { body: m.map(String) };
          code = 'VALIDATION_ERROR';
        } else {
          message = String(m ?? exception.message);
        }
      } else {
        message = exception.message;
      }
      /* 5xx HttpExceptions are not exposed verbatim. */
      if (status >= 500) message = 'An unexpected error occurred';
    }

    /* Server-side log: full detail, never to client. */
    if (status >= 500) {
      this.logger.error({
        msg: 'unhandled_error',
        correlationId,
        path: req.url,
        method: req.method,
        err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: exception.stack } : String(exception),
      });
    }

    const body: ApiErrorBody = {
      error: {
        code,
        message,
        ...(fieldErrors ? { fieldErrors } : {}),
        ...(details ? { details } : {}),
        correlationId,
      },
    };
    res.status(status).json(body);
  }
}
