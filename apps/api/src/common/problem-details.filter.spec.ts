import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toProblemDetails } from './problem-details.filter.js';

describe('toProblemDetails', () => {
  it('keeps the status and message of an expected HTTP error', () => {
    const problem = toProblemDetails(
      new NotFoundException('No employee exists with this ID.'),
      '/api/v1/employees/123',
      'trace-1',
    );

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No employee exists with this ID.',
      instance: '/api/v1/employees/123',
      traceId: 'trace-1',
    });
  });

  it('hides the details of unexpected errors from the client', () => {
    const problem = toProblemDetails(
      new Error('connect failed for postgresql://admin:hunter2@db.internal/samtec'),
      '/api/v1/health',
      'trace-2',
    );

    expect(problem.status).toBe(500);
    expect(problem.title).toBe('Internal Server Error');
    expect(JSON.stringify(problem)).not.toContain('hunter2');
  });

  it('lists every invalid field for validation errors', () => {
    const problem = toProblemDetails(
      new BadRequestException({
        message: [
          { path: ['phone'], message: 'Must look like +233241234567.' },
          { path: [{ key: 'address' }, 'city'], message: 'Required.' },
        ],
      }),
      '/api/v1/employees',
      'trace-3',
    );

    expect(problem.type).toBe('urn:samtec:problem:validation-error');
    expect(problem.status).toBe(400);
    expect(problem.errors).toEqual([
      { path: 'phone', message: 'Must look like +233241234567.' },
      { path: 'address.city', message: 'Required.' },
    ]);
  });
});
