import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().trim().min(1),
  IMAGE_API_BASE_URL: z.url().default('https://service.test.elvetech.io'),
  IMAGE_API_TOKEN: z.string().trim().min(1),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  UPSTREAM_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PENDING_STALE_SECONDS: z.coerce.number().int().positive().default(120),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function validateConfig(env: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(env);

  if (result.success) {
    return result.data;
  }

  const variableNames = [
    ...new Set(
      result.error.issues.map((issue) => String(issue.path[0] ?? 'unknown')),
    ),
  ];

  throw new Error(
    `Invalid environment variables: ${variableNames.join(', ')}`,
  );
}
