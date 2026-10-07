import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { SCOPE, SlackOAuthProvider } from './auth/slack.js';
import { buildMcpServer, type McpDeps } from './mcp.js';

export interface AppOptions {
  publicUrl: URL;
  /** Slack mode: the OAuth server. Dev mode: undefined, and `verifier` checks fixed tokens. */
  oauth?: SlackOAuthProvider;
  verifier: OAuthTokenVerifier;
  mcp: McpDeps;
  /** Sessions with no request for this long are closed. */
  sessionIdleMs?: number;
  trustProxy?: boolean;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  owner: string;
  lastSeen: number;
}

export interface BrainApp {
  app: Express;
  /** Close idle MCP sessions; call periodically. */
  sweepSessions(): void;
  closeAll(): Promise<void>;
}

const ownerOf = (req: Request) => String((req.auth?.extra as { userId?: string } | undefined)?.userId ?? '');

export function createApp(opts: AppOptions): BrainApp {
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', 1);
  const mcpUrl = new URL('/mcp', opts.publicUrl);
  const sessions = new Map<string, Session>();
  const idleMs = opts.sessionIdleMs ?? 24 * 60 * 60 * 1000;

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, sessions: sessions.size });
  });

  if (opts.oauth) {
    const oauth = opts.oauth;
    app.use(
      mcpAuthRouter({
        provider: oauth,
        issuerUrl: opts.publicUrl,
        resourceServerUrl: mcpUrl,
        scopesSupported: [SCOPE],
        resourceName: 'StoreLeads Brain',
      }),
    );
    app.get('/oauth/slack/callback', (req, res, next) => {
      oauth.handleSlackCallback(req, res).catch(next);
    });
  }

  const auth = requireBearerAuth({
    verifier: opts.verifier,
    requiredScopes: [SCOPE],
    // Only advertise OAuth when there is an OAuth server; in token mode a bad token should just fail.
    resourceMetadataUrl: opts.oauth ? getOAuthProtectedResourceMetadataUrl(mcpUrl) : undefined,
  });

  const closeSession = (id: string) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    opts.mcp.tracker.endConversation(id);
    s.transport.close().catch(() => undefined);
  };

  /** The session for this request, or undefined after replying 404 / 400. */
  const existingSession = (req: Request, res: Response): Session | undefined => {
    const id = req.header('mcp-session-id');
    if (!id) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Missing Mcp-Session-Id' }, id: null });
      return undefined;
    }
    const s = sessions.get(id);
    // Unknown, expired, or someone else's session: 404 makes the client start a new one.
    if (!s || s.owner !== ownerOf(req)) {
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
      return undefined;
    }
    s.lastSeen = Date.now();
    return s;
  };

  app.post('/mcp', auth, express.json({ limit: '4mb' }), async (req, res) => {
    try {
      if (req.header('mcp-session-id')) {
        const s = existingSession(req, res);
        if (s) await s.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Expected an initialize request' }, id: null });
        return;
      }
      const owner = ownerOf(req);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, owner, lastSeen: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) closeSession(transport.sessionId);
      };
      const server = buildMcpServer(opts.mcp);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      (opts.mcp.log ?? console.error)('POST /mcp failed', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const getOrDelete = async (req: Request, res: Response) => {
    const s = existingSession(req, res);
    if (s) await s.transport.handleRequest(req, res);
  };
  app.get('/mcp', auth, getOrDelete);
  app.delete('/mcp', auth, getOrDelete);

  return {
    app,
    sweepSessions() {
      const cutoff = Date.now() - idleMs;
      for (const [id, s] of sessions) if (s.lastSeen < cutoff) closeSession(id);
    },
    async closeAll() {
      for (const id of [...sessions.keys()]) closeSession(id);
    },
  };
}
