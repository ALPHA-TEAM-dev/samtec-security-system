import { STATUS_CODES } from 'node:http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ProblemDetails, ValidationIssue } from '@samtec/contracts';
import type { Request, Response } from 'express';
import { getRequestId } from './request-id.middleware.js';

/**
 * Turns every error into a Problem Details response (RFC 9457): the error
 * format promised in the API contract.
 *
 * - Expected errors (Nest `HttpException`s such as `NotFoundException`) keep
 *   their status code and message.
 * - Unexpected errors become a generic 500. The real error is logged with the
 *   request's traceId but never sent to the client, because stack traces and
 *   internal messages help attackers.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    // `originalUrl` keeps the full path (including /api/v1), even inside Nest's
    // not-found handler. The query string is dropped, so search terms never
    // appear in error responses or logs.
    const path = request.originalUrl.split('?')[0] ?? request.path;
    const problem = toProblemDetails(exception, path, getRequestId(response));

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${path} failed (traceId ${problem.traceId})`, stack);
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }
}

/** Builds the Problem Details body for anything that was thrown. */
export function toProblemDetails(
  exception: unknown,
  instance: string,
  traceId: string,
): ProblemDetails {
  if (!(exception instanceof HttpException)) {
    return {
      type: 'about:blank',
      title: titleFor(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Something went wrong on our side. Please share the traceId with the SAMTEC team.',
      instance,
      traceId,
    };
  }

  const status = exception.getStatus();
  const { detail, errors } = describeHttpException(exception);

  if (errors.length > 0) {
    return {
      type: 'urn:samtec:problem:validation-error',
      title: 'Validation failed',
      status,
      detail,
      instance,
      traceId,
      errors,
    };
  }

  return { type: 'about:blank', title: titleFor(status), status, detail, instance, traceId };
}

function titleFor(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/**
 * A Nest exception carries either a plain string or an object such as
 * `{ message: 'Not Found' }`, or `{ message: [...] }` for validation errors.
 */
function describeHttpException(exception: HttpException): {
  detail: string;
  errors: ValidationIssue[];
} {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return { detail: body, errors: [] };
  }

  const message = 'message' in body ? body.message : undefined;
  if (Array.isArray(message)) {
    return {
      detail: 'One or more fields are invalid.',
      errors: message.map((item) => toValidationIssue(item)),
    };
  }

  return { detail: typeof message === 'string' ? message : exception.message, errors: [] };
}

function toValidationIssue(item: unknown): ValidationIssue {
  if (typeof item === 'string') {
    return { path: '', message: item };
  }
  if (typeof item === 'object' && item !== null) {
    const path = 'path' in item ? formatPath(item.path) : '';
    const message =
      'message' in item && typeof item.message === 'string' ? item.message : 'Invalid value.';
    return { path, message };
  }
  return { path: '', message: 'Invalid value.' };
}

/** Turns a path such as ['address', 'city'] into 'address.city'. */
function formatPath(path: unknown): string {
  if (typeof path === 'string') {
    return path;
  }
  if (!Array.isArray(path)) {
    return '';
  }
  return path
    .map((segment: unknown) =>
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? String(segment.key)
        : String(segment),
    )
    .join('.');
}
