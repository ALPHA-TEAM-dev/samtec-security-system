import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry a failed request once, then show the error state.
      retry: 1,
      // Treat loaded data as fresh for 30 seconds to avoid needless refetching.
      staleTime: 30_000,
    },
  },
});

/** The whole dashboard: data fetching (React Query) around the pages (React Router). */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
