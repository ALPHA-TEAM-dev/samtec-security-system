/**
 * Dashboard settings, read once from Vite.
 *
 * Only variables that start with `VITE_` reach the browser, and anything in the
 * browser is public, so never put secrets here.
 */
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
  /**
   * True when the dashboard runs with pretend data (`pnpm dev:web`), false when
   * it calls the real API (`pnpm dev:web:live`, `pnpm dev`, production builds).
   */
  useMocks: import.meta.env.MODE === 'mock',
} as const;
