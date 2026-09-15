import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { EmployeesPage } from '@/pages/employees-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { SystemStatusPage } from '@/pages/system-status-page';

/**
 * Every page of the dashboard and its web address.
 * Add new pages here as each roadmap phase builds them, and switch on their
 * link in `components/layout/nav-items.ts`.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <SystemStatusPage /> },
      { path: 'employees', element: <EmployeesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
