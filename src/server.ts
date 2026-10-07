import Anthropic from '@anthropic-ai/sdk';
import { ClickHouseLogLevel, createClient } from '@clickhouse/client';
import { createApp } from './app.js';
import { SlackOAuthProvider } from './auth/slack.js';
import { StaticTokenVerifier } from './auth/static.js';
import { TokenSigner } from './auth/tokens.js';
import { loadConfig } from './config.js';
import { Distiller, claudeClassifier } from './distiller.js';
import { clickhouseRunner } from './query.js';
import { ClickHouseUsageStore } from './store.js';
import { TurnTracker } from './turns.js';

const log = (msg: string, err?: unknown) => console.error(`[brain] ${msg}`, err ?? '');

const config = loadConfig();

// Query errors on the read client are Claude's SQL mistakes, returned to it as tool errors: don't log them too.
const read = createClient({
  url: config.clickhouse.url,
  username: config.clickhouse.read.user,
  password: config.clickhouse.read.password,
  database: 'slim',
  log: { level: ClickHouseLogLevel.OFF },
});
const write = createClient({ url: config.clickhouse.url, username: config.clickhouse.write.user, password: config.clickhouse.write.password });
const store = new ClickHouseUsageStore(write, config.clickhouse.usageDb);

const distiller = config.distill.enabled
  ? new Distiller({ store, classify: claudeClassifier(new Anthropic(), config.distill.model), model: config.distill.model, log })
  : undefined;
if (!distiller) log('distiller off (no ANTHROPIC_API_KEY or DISTILL_DISABLED=1): turns are logged but not labelled');

const tracker = new TurnTracker({
  idleMs: config.turnIdleMinutes * 60_000,
  logAll: config.logAllTurns,
  log,
  persist: async (turn) => {
    await store.insertTurn(turn);
    distiller?.enqueue(turn);
  },
});

const signer = new TokenSigner(config.jwtSecret, config.publicUrl.href);
const oauth =
  config.authMode === 'slack'
    ? new SlackOAuthProvider(signer, config.slack, new URL('/oauth/slack/callback', config.publicUrl))
    : undefined;
if (!oauth) log('AUTH_MODE=token: personal bearer tokens, no Slack sign-in');

const brain = createApp({
  publicUrl: config.publicUrl,
  oauth,
  verifier: oauth ?? new StaticTokenVerifier(config.tokens, log),
  trustProxy: process.env.TRUST_PROXY === '1',
  mcp: { runQuery: clickhouseRunner(read, config.query), tracker, store, maxRows: config.query.maxRows, log },
});

const timer = setInterval(() => {
  tracker.sweep();
  brain.sweepSessions();
}, 60_000);

const http = brain.app.listen(config.port, () => log(`listening on :${config.port}, public ${config.publicUrl.href}`));

async function shutdown() {
  clearInterval(timer);
  http.close();
  await brain.closeAll();
  tracker.closeAll();
  await tracker.flush();
  await distiller?.drained();
  await Promise.all([read.close(), write.close()]);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
