import type { HealthResponse } from '@samtec/contracts';
import { cn } from 'cn';
import { CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { $api } from '@/lib/api';
import { env } from '@/lib/env';
import { formatDateTime, formatDuration } from '@/lib/format';

/** A 503 answer still carries a health report, so a report can arrive as data or as the error. */
function isHealthReport(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null && 'status' in value && 'checks' in value;
}

/**
 * Shows whether the dashboard can reach the API, and whether the API can reach
 * its database. This page is the Phase 0 exit demo, and the simplest example of
 * loading data from the API.
 */
export function SystemStatusPage() {
  const health = $api.useQuery('get', '/health');

  const candidate: unknown = health.data ?? health.error;
  const report = isHealthReport(candidate) ? candidate : undefined;
  const apiReachable = report !== undefined;
  const databaseUp = report?.checks.database === 'up';

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">System status</h1>
          <p className="text-muted-foreground text-sm">
            Checks that the dashboard can reach the SAMTEC API, and that the API can reach its
            database.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          <RefreshCw aria-hidden="true" className={cn(health.isFetching && 'animate-spin')} />
          Check again
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard
          title="API"
          description={env.useMocks ? 'Mock API running in this browser' : env.apiBaseUrl}
          loading={health.isPending}
          ok={apiReachable}
          okLabel="Reachable"
          failLabel="Not reachable"
        />
        <StatusCard
          title="Database"
          description="PostgreSQL"
          loading={health.isPending}
          ok={databaseUp}
          okLabel="Connected"
          failLabel={apiReachable ? 'Down' : 'Unknown'}
        />
      </div>

      {!health.isPending && !apiReachable && (
        <Alert variant="destructive">
          <AlertTitle>The dashboard cannot reach the API</AlertTitle>
          <AlertDescription>
            Start the API with pnpm dev:api, or run the dashboard with pretend data using pnpm
            dev:web.
          </AlertDescription>
        </Alert>
      )}

      {report && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm tabular-nums">
              <DetailRow term="Version">{report.version}</DetailRow>
              <DetailRow term="Environment">{report.environment}</DetailRow>
              <DetailRow term="Uptime">{formatDuration(report.uptimeSeconds)}</DetailRow>
              <DetailRow term="Server time (Ghana)">{formatDateTime(report.time)}</DetailRow>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface StatusCardProps {
  title: string;
  description: string;
  loading: boolean;
  ok: boolean;
  okLabel: string;
  failLabel: string;
}

function StatusCard({ title, description, loading, ok, okLabel, failLabel }: StatusCardProps) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="truncate">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-6 w-32" />
        ) : (
          <p
            className={cn(
              'flex items-center gap-2 font-medium',
              ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive',
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
            {ok ? okLabel : failLabel}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
