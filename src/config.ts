// All runtime settings come from the environment (see .env.example).

export type AuthMode = 'slack' | 'token';

export interface Config {
  port: number;
  /** Public base URL of this server, e.g. https://brain.ecvision.ai — the OAuth issuer and the /mcp resource live under it. */
  publicUrl: URL;
  authMode: AuthMode;
  /** HS256 key for every token this server signs (client ids, auth codes, access/refresh tokens). */
  jwtSecret: Uint8Array;
  slack: { clientId: string; clientSecret: string; teamId: string };
  /** token mode: bearer tokens from ACCESS_TOKENS ("token:user,…") and/or TOKENS_FILE ("token user [name]" per line). */
  tokens: { inline: string; file: string; minLength: number };
  clickhouse: {
    url: string;
    /** Read-only user that can only SELECT from `slim` (enforced by ClickHouse grants, profile readonly=2). */
    read: { user: string; password: string };
    /** Writer for the usage database (qa_log, qa_distill, memory). */
    write: { user: string; password: string };
    usageDb: string;
  };
  query: { maxRows: number; timeoutSeconds: number };
  turnIdleMinutes: number;
  /** Log every turn the hooks see, not only those that ran a query or called record. */
  logAllTurns: boolean;
  distill: { enabled: boolean; model: string };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = (env.AUTH_MODE ?? 'slack') as AuthMode;
  if (authMode !== 'slack' && authMode !== 'token') throw new Error(`AUTH_MODE must be slack or token, got ${authMode}`);

  const secret = required(env, 'JWT_SECRET');
  if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  return {
    port: Number(env.PORT ?? 8080),
    publicUrl: new URL(required(env, 'PUBLIC_URL')),
    authMode,
    jwtSecret: new TextEncoder().encode(secret),
    slack: {
      clientId: authMode === 'slack' ? required(env, 'SLACK_CLIENT_ID') : '',
      clientSecret: authMode === 'slack' ? required(env, 'SLACK_CLIENT_SECRET') : '',
      teamId: authMode === 'slack' ? required(env, 'SLACK_TEAM_ID') : '',
    },
    tokens: {
      inline: env.ACCESS_TOKENS ?? '',
      file: env.TOKENS_FILE ?? '',
      // Short tokens are for local runs only.
      minLength: env.NODE_ENV === 'production' ? 32 : 1,
    },
    clickhouse: {
      url: required(env, 'CLICKHOUSE_URL'),
      read: { user: required(env, 'CLICKHOUSE_READ_USER'), password: env.CLICKHOUSE_READ_PASSWORD ?? '' },
      write: { user: required(env, 'CLICKHOUSE_WRITE_USER'), password: env.CLICKHOUSE_WRITE_PASSWORD ?? '' },
      usageDb: env.CLICKHOUSE_USAGE_DB ?? 'usage',
    },
    query: {
      // The skill shows at most 100 stores (500 when asked); 500 is the hard ceiling here.
      maxRows: Number(env.QUERY_MAX_ROWS ?? 500),
      timeoutSeconds: Number(env.QUERY_TIMEOUT_SECONDS ?? 60),
    },
    turnIdleMinutes: Number(env.TURN_IDLE_MINUTES ?? 15),
    logAllTurns: env.LOG_ALL_TURNS === '1',
    distill: {
      enabled: Boolean(env.ANTHROPIC_API_KEY) && env.DISTILL_DISABLED !== '1',
      model: env.DISTILL_MODEL ?? 'claude-opus-5-5',
    },
  };
}
