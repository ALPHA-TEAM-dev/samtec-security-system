import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Loads `apps/api/.env` into `process.env` when the file exists.
 * Uses the loader built into Node.js, so no extra package is needed.
 */
export function loadEnvFile(path = '.env'): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

/**
 * Every environment variable the API reads, and the rule each one must follow.
 *
 * The API refuses to start when a value is missing or wrong ("fail fast"), so
 * configuration mistakes appear at startup instead of in the middle of a request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error:
      'DATABASE_URL must be a PostgreSQL URL like postgresql://user:password@host:5432/database',
  }),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(z.url()).min(1, 'CORS_ORIGINS needs at least one website address')),
});

export type Env = z.infer<typeof envSchema>;

/** Checks raw environment variables and returns typed, trusted values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration. Compare apps/api/.env with apps/api/.env.example.\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
