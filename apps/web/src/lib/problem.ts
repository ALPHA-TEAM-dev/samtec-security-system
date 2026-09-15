import type { ProblemDetails } from '@samtec/contracts';

/** True when a value looks like a Problem Details error body sent by the API. */
export function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'title' in value &&
    'traceId' in value
  );
}

/**
 * Turns anything a request can fail with into a message for the user.
 * When the API is not running there is no Problem Details body at all, only a
 * network error, so that case gets its own message.
 */
export function describeApiError(error: unknown): { message: string; traceId?: string } {
  if (isProblemDetails(error)) {
    return { message: error.detail ?? error.title, traceId: error.traceId };
  }
  return { message: 'Could not reach the SAMTEC API. Check that it is running, then try again.' };
}
