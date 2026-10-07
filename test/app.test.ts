import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { SlackOAuthProvider } from '../src/auth/slack.js';
import { StaticTokenVerifier } from '../src/auth/static.js';
import { TokenSigner } from '../src/auth/tokens.js';
import type { RunQuery } from '../src/query.js';
import { InMemoryUsageStore } from '../src/store.js';
import { TurnTracker } from '../src/turns.js';

const fakeQuery: RunQuery = async (sql) =>
  sql.includes('boom')
    ? { ok: false, columns: [], rows: [], rowCount: 0, truncated: false, error: 'Code: 62. Syntax error', ms: 1 }
    : { ok: true, columns: ['app', 'stores'], rows: [['Klaviyo', 12943]], rowCount: 1, truncated: false, error: '', ms: 3 };

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function start(oauth?: SlackOAuthProvider, publicUrl?: URL) {
  const store = new InMemoryUsageStore();
  const tracker = new TurnTracker({ idleMs: 60_000, persist: (t) => store.insertTurn(t) });
  const brain = createApp({
    publicUrl: publicUrl ?? new URL('http://localhost'),
    oauth,
    verifier: oauth ?? new StaticTokenVerifier({ inline: 'tok-an:U_AN,tok-binh:U_BINH', file: '', minLength: 1 }),
    mcp: { runQuery: fakeQuery, tracker, store, maxRows: 500, log: () => undefined },
  });
  const http = brain.app.listen(0);
  servers.push(http);
  await new Promise((r) => http.once('listening', r));
  const base = new URL(`http://localhost:${(http.address() as AddressInfo).port}`);
  return { store, tracker, base, brain };
}

async function connect(base: URL, token: string, name = 'claude-ai') {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

describe('MCP endpoint (token auth)', () => {
  it('rejects requests without a valid token', async () => {
    const { base } = await start();
    const res = await fetch(new URL('/mcp', base), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
    // Token mode has no OAuth server to point clients at.
    expect(res.headers.get('www-authenticate')).not.toContain('resource_metadata');
  });

  it('tells an installer whose token it is', async () => {
    const { base } = await start();
    const ok = await fetch(new URL('/whoami', base), { headers: { authorization: 'Bearer tok-an' } });
    expect(await ok.json()).toEqual({ userId: 'U_AN', userName: 'U_AN' });
    expect((await fetch(new URL('/whoami', base), { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('runs a whole web-style turn and logs it with the user and client', async () => {
    const { base, store, tracker } = await start();
    const { client } = await connect(base, 'tok-an');

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['query_sql', 'recall', 'record']);

    expect(text(await client.callTool({ name: 'recall', arguments: { question: 'Klaviyo có bao nhiêu store?' } }))).toMatch(/No team memory/);
    const bad = await client.callTool({ name: 'query_sql', arguments: { sql: 'SELECT boom' } });
    expect(bad.isError).toBe(true);
    const good = await client.callTool({ name: 'query_sql', arguments: { sql: 'SELECT 1' } });
    expect(text(good)).toContain('Klaviyo\t12943');
    await client.callTool({ name: 'record', arguments: { answer: 'Klaviyo: 12.943 store (9/2026)', outcome: 'answered' } });
    await tracker.flush();

    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]).toMatchObject({
      userId: 'U_AN',
      client: 'claude-ai',
      question: 'Klaviyo có bao nhiêu store?',
      answer: 'Klaviyo: 12.943 store (9/2026)',
      modelOutcome: 'answered',
    });
    expect(store.turns[0].queries.map((q) => q.ok)).toEqual([false, true]);
    await client.close();
  });

  it('hook calls return empty text when there is nothing to add', async () => {
    const { base } = await start();
    const { client } = await connect(base, 'tok-an', 'claude-code');
    const r = await client.callTool({ name: 'recall', arguments: { question: 'fix my css', via: 'hook' } });
    expect(text(r)).toBe('');
    await client.close();
  });

  it('hook recall returns hook JSON, the only form Claude Code adds to the context', async () => {
    const { base, store } = await start();
    await store.putMemory({
      id: 'm1', kind: 'alias', scope: 'team', dedupeKey: 'alias:yotpo', keys: ['yotpo'], text: 'Yotpo = yotpo-product-reviews',
      sql: '', snapshotMonth: -1, status: 'verified', evidence: 3, sourceTurns: [], createdBy: 'U1', updatedAt: new Date(),
    });
    const { client } = await connect(base, 'tok-an', 'claude-code');
    const out = JSON.parse(text(await client.callTool({ name: 'recall', arguments: { question: 'Yotpo size?', via: 'hook' } })));
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput.additionalContext).toContain('Yotpo = yotpo-product-reviews');
    await client.close();
  });

  it("does not let one user use another user's session", async () => {
    const { base } = await start();
    const { client, transport } = await connect(base, 'tok-an');
    const res = await fetch(new URL('/mcp', base), {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok-binh',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': transport.sessionId!,
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    });
    expect(res.status).toBe(404);
    await client.close();
  });
});

describe('Slack OAuth flow', () => {
  function fakeSlack(teamId: string) {
    return (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('openid.connect.token')) return Response.json({ ok: true, access_token: 'xoxp-test' });
      if (u.endsWith('openid.connect.userInfo')) {
        return Response.json({ ok: true, sub: 'U_SLACK', name: 'Toàn', email: 't@q.io', 'https://slack.com/team_id': teamId });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
  }

  async function startOAuth(teamFromSlack: string) {
    // The issuer must be the address the test talks to, so bind first, then build the provider.
    const probe = await start();
    const port = probe.base.port;
    for (const s of servers.splice(0)) s.close();
    const publicUrl = new URL(`http://localhost:${port}`);
    const signer = new TokenSigner(new TextEncoder().encode('x'.repeat(40)), publicUrl.href);
    const oauth = new SlackOAuthProvider(
      signer,
      { clientId: 'slack-client', clientSecret: 'slack-secret', teamId: 'T_QIKIFY' },
      new URL('/oauth/slack/callback', publicUrl),
      fakeSlack(teamFromSlack),
    );
    const store = new InMemoryUsageStore();
    const tracker = new TurnTracker({ idleMs: 60_000, persist: (t) => store.insertTurn(t) });
    const brain = createApp({ publicUrl, oauth, verifier: oauth, mcp: { runQuery: fakeQuery, tracker, store, maxRows: 500, log: () => undefined } });
    const http = brain.app.listen(Number(port));
    servers.push(http);
    await new Promise((r) => http.once('listening', r));
    return { base: publicUrl, store, tracker };
  }

  async function signIn(base: URL) {
    const meta = await (await fetch(new URL('/.well-known/oauth-authorization-server', base))).json();
    const redirectUri = 'http://localhost:9999/callback';
    const reg = await (
      await fetch(meta.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', client_name: 'Claude' }),
      })
    ).json();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'abc',
    }).toString();
    const toSlack = await fetch(authUrl, { redirect: 'manual' });
    const slackUrl = new URL(toSlack.headers.get('location')!);
    expect(slackUrl.host).toBe('slack.com');
    const callback = new URL('/oauth/slack/callback', base);
    callback.search = new URLSearchParams({ code: 'slack-code', state: slackUrl.searchParams.get('state')! }).toString();
    const back = new URL((await fetch(callback, { redirect: 'manual' })).headers.get('location')!);
    return { meta, reg, verifier, redirectUri, back };
  }

  const tokenRequest = (meta: { token_endpoint: string }, body: Record<string, string>) =>
    fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

  it('signs a Slack member in, issues tokens that work on /mcp, refreshes, and refuses code reuse', async () => {
    const { base, store, tracker } = await startOAuth('T_QIKIFY');
    const { meta, reg, verifier, redirectUri, back } = await signIn(base);
    expect(back.searchParams.get('state')).toBe('abc');
    const code = back.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const codeGrant = { grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: verifier, redirect_uri: redirectUri };
    const tokRes = await tokenRequest(meta, codeGrant);
    expect(tokRes.status).toBe(200);
    const tokens = await tokRes.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });

    expect((await tokenRequest(meta, codeGrant)).status).toBe(400); // single use

    const { client } = await connect(base, tokens.access_token);
    await client.callTool({ name: 'query_sql', arguments: { sql: 'SELECT 1' } });
    await client.callTool({ name: 'record', arguments: { answer: 'ok' } });
    await tracker.flush();
    expect(store.turns[0]).toMatchObject({ userId: 'U_SLACK', userName: 'Toàn' });
    await client.close();

    const refreshed = await tokenRequest(meta, { grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: tokens.refresh_token });
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).access_token).toBeTruthy();
  });

  it('refuses a wrong PKCE verifier', async () => {
    const { base } = await startOAuth('T_QIKIFY');
    const { meta, reg, redirectUri, back } = await signIn(base);
    const res = await tokenRequest(meta, {
      grant_type: 'authorization_code',
      client_id: reg.client_id,
      code: back.searchParams.get('code')!,
      code_verifier: 'wrong'.repeat(10),
      redirect_uri: redirectUri,
    });
    expect(res.status).toBe(400);
  });

  it('sends people from another Slack workspace back with access_denied', async () => {
    const { base } = await startOAuth('T_OTHER');
    const { back } = await signIn(base);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
  });
});
