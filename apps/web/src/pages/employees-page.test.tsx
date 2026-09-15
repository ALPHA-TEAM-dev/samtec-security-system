import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { server } from '@/mocks/node';
import { renderWithProviders } from '@/test/render';
import { EmployeesPage } from './employees-page';

describe('EmployeesPage', () => {
  it('lists employees from the API', async () => {
    renderWithProviders(<EmployeesPage />);

    expect(await screen.findByText('Kwame Kofi Mensah')).toBeInTheDocument();
    expect(screen.getByText('SMT-00001')).toBeInTheDocument();
  });

  it('shows a message when no employee matches the search', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('Kwame Kofi Mensah');

    await user.type(screen.getByLabelText('Search employees'), 'Nobody-By-This-Name');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No employees match these filters.')).toBeInTheDocument();
  });

  it('explains the problem when the API fails', async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/employees`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            detail: 'The database is not available.',
            traceId: 'trace-test-1',
          },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<EmployeesPage />);

    expect(await screen.findByText('The database is not available.')).toBeInTheDocument();
    expect(screen.getByText('Trace ID: trace-test-1')).toBeInTheDocument();
  });
});
