import type {
  Employee,
  EmployeeList,
  EmployeeListItem,
  HealthResponse,
  ProblemDetails,
  Site,
  SiteList,
} from '@samtec/contracts';
import { type DefaultBodyType, HttpResponse, http, type PathParams } from 'msw';
import { env } from '@/lib/env';
import { mockEmployees } from './data/employees';
import { mockSites } from './data/sites';

/**
 * The mock API: pretend versions of the real endpoints, so the dashboard can be
 * built and tested before the backend exists.
 *
 * Rules for these handlers:
 * - Response bodies use the contract types, so TypeScript catches mismatches.
 * - Each handler lists every body it can send back (its success shape and
 *   ProblemDetails), so TypeScript checks all of them.
 * - Behave the way the contract describes, including its errors (400, 404).
 * - When `openapi.yaml` changes, update these handlers in the same pull request.
 */

const url = (path: string) => `${env.apiBaseUrl}${path}`;
const startedAt = Date.now();

/** Every body a handler may return: its success shape, or a Problem Details error. */
type OrProblem<Body extends DefaultBodyType> = Body | ProblemDetails;

export const handlers = [
  http.get(url('/health'), () =>
    HttpResponse.json<HealthResponse>({
      status: 'ok',
      version: '0.1.0-mock',
      environment: 'development',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
      checks: { database: 'up' },
    }),
  ),

  http.get<PathParams, DefaultBodyType, OrProblem<EmployeeList>>(
    url('/employees'),
    ({ request }) => {
      const query = new URL(request.url).searchParams;
      const search = query.get('search')?.trim().toLowerCase();
      if (search !== undefined && search.length < 2) {
        return validationProblem('search', 'Search needs at least 2 characters.');
      }
      const status = query.get('status');
      const siteId = query.get('siteId');

      const matches = mockEmployees
        .filter((employee) => !status || employee.status === status)
        .filter((employee) => !siteId || employee.currentSite?.id === siteId)
        .filter(
          (employee) =>
            !search ||
            [employee.staffNumber, employee.firstName, employee.lastName].some((value) =>
              value.toLowerCase().includes(search),
            ),
        )
        .sort((a, b) => a.staffNumber.localeCompare(b.staffNumber))
        .map(toListItem);

      const page = pageOf(matches, query);
      if (!page) {
        return validationProblem('cursor', 'The cursor is not valid.');
      }
      return HttpResponse.json<EmployeeList>(page);
    },
  ),

  http.get<PathParams, DefaultBodyType, OrProblem<Employee>>(
    url('/employees/:employeeId'),
    ({ params }) => {
      const employee = mockEmployees.find((candidate) => candidate.id === params.employeeId);
      return employee
        ? HttpResponse.json<Employee>(employee)
        : notFound('No employee exists with this ID.');
    },
  ),

  http.get<PathParams, DefaultBodyType, OrProblem<SiteList>>(url('/sites'), ({ request }) => {
    const query = new URL(request.url).searchParams;
    const status = query.get('status');
    const region = query.get('region');

    const matches = mockSites
      .filter((site) => !status || site.status === status)
      .filter((site) => !region || site.region === region);

    const page = pageOf(matches, query);
    if (!page) {
      return validationProblem('cursor', 'The cursor is not valid.');
    }
    return HttpResponse.json<SiteList>(page);
  }),

  http.get<PathParams, DefaultBodyType, OrProblem<Site>>(url('/sites/:siteId'), ({ params }) => {
    const site = mockSites.find((candidate) => candidate.id === params.siteId);
    return site ? HttpResponse.json<Site>(site) : notFound('No site exists with this ID.');
  }),
];

/** The short list form of an employee, without sensitive identity fields (like the real API). */
function toListItem(employee: Employee): EmployeeListItem {
  return {
    id: employee.id,
    staffNumber: employee.staffNumber,
    fullName: employee.fullName,
    position: employee.position,
    status: employee.status,
    biometricEnrolled: employee.biometricEnrolled,
    currentSite: employee.currentSite,
    hireDate: employee.hireDate,
  };
}

/**
 * Cursor pagination, like the real API. The cursor is an opaque string; here it
 * simply encodes the position of the next item. Returns undefined for a bad cursor.
 */
function pageOf<T>(
  all: T[],
  query: URLSearchParams,
): { items: T[]; nextCursor: string | null } | undefined {
  const requestedLimit = Number(query.get('limit') ?? 25);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 25;
  const cursor = query.get('cursor');

  let offset = 0;
  if (cursor !== null) {
    try {
      offset = Number.parseInt(atob(cursor), 10);
    } catch {
      return undefined;
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return undefined;
    }
  }

  const end = offset + limit;
  return { items: all.slice(offset, end), nextCursor: end < all.length ? btoa(String(end)) : null };
}

function problemResponse(problem: Omit<ProblemDetails, 'traceId'>): HttpResponse<ProblemDetails> {
  return HttpResponse.json<ProblemDetails>(
    { ...problem, traceId: crypto.randomUUID() },
    { status: problem.status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function notFound(detail: string): HttpResponse<ProblemDetails> {
  return problemResponse({ type: 'about:blank', title: 'Not Found', status: 404, detail });
}

function validationProblem(path: string, message: string): HttpResponse<ProblemDetails> {
  return problemResponse({
    type: 'urn:samtec:problem:validation-error',
    title: 'Validation failed',
    status: 400,
    detail: 'One or more fields are invalid.',
    errors: [{ path, message }],
  });
}
