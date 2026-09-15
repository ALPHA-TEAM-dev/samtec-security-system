import type { HealthResponse } from '@samtec/contracts';
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { server } from '@/mocks/node';
import { renderWithProviders } from '@/test/render';
import { SystemStatusPage } from './system-status-page';

describe('SystemStatusPage', () => {
  it('shows the API and the database as working', async () => {
    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('Reachable')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows the database as down when the API reports a problem', async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/health`, () =>
        HttpResponse.json<HealthResponse>(
          {
            status: 'degraded',
            version: '0.1.0',
            environment: 'test',
            uptimeSeconds: 5,
            time: '2026-09-15T08:30:00Z',
            checks: { database: 'down' },
          },
          { status: 503 },
        ),
      ),
    );

    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('Down')).toBeInTheDocument();
    expect(screen.getByText('Reachable')).toBeInTheDocument();
  });

  it('explains what to do when the API is not running', async () => {
    server.use(http.get(`${env.apiBaseUrl}/health`, () => HttpResponse.error()));

    renderWithProviders(<SystemStatusPage />);

    expect(await screen.findByText('The dashboard cannot reach the API')).toBeInTheDocument();
    expect(screen.getByText('Not reachable')).toBeInTheDocument();
  });
});
