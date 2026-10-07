import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { TokenSigner } from './tokens.js';

// OAuth 2.1 authorization server for MCP clients (Claude Code, claude.ai connectors, Claude Desktop),
// with "Sign in with Slack" (OpenID Connect) as the only way to log in. Only members of SLACK_TEAM_ID get in.
//
//   client ──/authorize──▶ us ──302──▶ Slack ──/oauth/slack/callback──▶ us ──302 code──▶ client
//   client ──/token (code + PKCE verifier)──▶ us ──▶ access + refresh token
//
// Stateless: see tokens.ts. Trade-off: a token cannot be revoked before it expires, so lifetimes are short
// (access 1 h) and refresh tokens last 7 days — someone removed from Slack loses access within a week.

export const SCOPE = 'storeleads';
const FLOW_TTL = 10 * 60;
const CODE_TTL = 5 * 60;
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 7 * 24 * 60 * 60;

export interface SlackSettings {
  clientId: string;
  clientSecret: string;
  teamId: string;
}

export interface UserClaims {
  sub: string;
  name: string;
  email: string;
}

interface FlowClaims {
  cid: string;
  ru: string;
  cc: string;
  st?: string;
  sc: string[];
  rs?: string;
  nonce: string;
}

interface CodeClaims extends FlowClaims, UserClaims {
  jti: string;
}

interface GrantClaims extends UserClaims {
  cid: string;
  sc: string[];
  rs?: string;
}

type Fetch = typeof fetch;

export class SlackOAuthProvider implements OAuthServerProvider {
  /** Authorization codes already exchanged (single use), with their expiry. */
  private readonly usedCodes = new Map<string, number>();

  constructor(
    private readonly signer: TokenSigner,
    private readonly slack: SlackSettings,
    private readonly callbackUrl: URL,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      // The client id is the signed registration itself; the secret is derived from the id.
      getClient: async (clientId) => {
        try {
          const { meta } = await this.signer.verify<{ meta: Omit<OAuthClientInformationFull, 'client_id'> }>(
            'client',
            clientId,
          );
          const confidential = meta.token_endpoint_auth_method !== 'none';
          return {
            ...meta,
            client_id: clientId,
            ...(confidential ? { client_secret: this.signer.clientSecret(clientId) } : {}),
          };
        } catch {
          return undefined;
        }
      },
      registerClient: async (client) => {
        const { client_secret: _s, client_secret_expires_at: _e, ...meta } = client;
        const issuedAt = Math.floor(Date.now() / 1000);
        const clientId = await this.signer.sign('client', { meta: { ...meta, client_id_issued_at: issuedAt } });
        const confidential = meta.token_endpoint_auth_method !== 'none';
        return {
          ...meta,
          client_id: clientId,
          client_id_issued_at: issuedAt,
          ...(confidential ? { client_secret: this.signer.clientSecret(clientId), client_secret_expires_at: 0 } : {}),
        };
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const nonce = randomUUID();
    const flow: FlowClaims = {
      cid: client.client_id,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      st: params.state,
      sc: params.scopes?.length ? params.scopes : [SCOPE],
      rs: params.resource?.href,
      nonce,
    };
    const state = await this.signer.sign('flow', { ...flow }, FLOW_TTL);
    const url = new URL('https://slack.com/openid/connect/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      scope: 'openid profile email',
      client_id: this.slack.clientId,
      redirect_uri: this.callbackUrl.href,
      state,
      nonce,
      team: this.slack.teamId,
    }).toString();
    res.redirect(url.href);
  }

  /** GET /oauth/slack/callback — Slack sends the person back here. */
  async handleSlackCallback(req: Request, res: Response): Promise<void> {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    let flow: FlowClaims;
    try {
      flow = await this.signer.verify<FlowClaims>('flow', state ?? '');
    } catch {
      res.status(400).send('Sign-in link expired or invalid. Start again from Claude.');
      return;
    }
    const back = new URL(flow.ru);
    if (flow.st) back.searchParams.set('state', flow.st);
    if (error || !code) {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', error ?? 'Slack sign-in was cancelled');
      res.redirect(back.href);
      return;
    }

    let user: UserClaims;
    try {
      user = await this.slackUser(code);
    } catch (err) {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', err instanceof Error ? err.message : 'Slack sign-in failed');
      res.redirect(back.href);
      return;
    }

    const claims: CodeClaims = { ...flow, ...user, jti: randomUUID() };
    back.searchParams.set('code', await this.signer.sign('code', { ...claims }, CODE_TTL));
    res.redirect(back.href);
  }

  private async slackUser(code: string): Promise<UserClaims> {
    const tokenRes = await this.fetchImpl('https://slack.com/api/openid.connect.token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.slack.clientId,
        client_secret: this.slack.clientSecret,
        code,
        redirect_uri: this.callbackUrl.href,
      }),
    });
    const token = (await tokenRes.json()) as { ok: boolean; access_token?: string; error?: string };
    if (!token.ok || !token.access_token) throw new Error(`Slack token exchange failed: ${token.error ?? 'unknown'}`);

    const infoRes = await this.fetchImpl('https://slack.com/api/openid.connect.userInfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const info = (await infoRes.json()) as Record<string, unknown>;
    if (!info.ok) throw new Error(`Slack userInfo failed: ${String(info.error ?? 'unknown')}`);
    if (info['https://slack.com/team_id'] !== this.slack.teamId) {
      throw new Error('This Slack workspace is not allowed');
    }
    return { sub: String(info.sub), name: String(info.name ?? ''), email: String(info.email ?? '') };
  }

  private async readCode(client: OAuthClientInformationFull, code: string): Promise<CodeClaims> {
    let claims: CodeClaims;
    try {
      claims = await this.signer.verify<CodeClaims>('code', code);
    } catch {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    if (claims.cid !== client.client_id) throw new InvalidGrantError('Code was issued to another client');
    return claims;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return (await this.readCode(client, code)).cc;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const claims = await this.readCode(client, code);
    if (redirectUri && redirectUri !== claims.ru) throw new InvalidGrantError('redirect_uri does not match');
    this.forgetExpiredCodes();
    if (this.usedCodes.has(claims.jti)) throw new InvalidGrantError('Authorization code already used');
    this.usedCodes.set(claims.jti, Date.now() + CODE_TTL * 1000);
    return this.issue({ sub: claims.sub, name: claims.name, email: claims.email, cid: claims.cid, sc: claims.sc, rs: claims.rs });
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    let claims: GrantClaims;
    try {
      claims = await this.signer.verify<GrantClaims>('refresh', refreshToken);
    } catch {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }
    if (claims.cid !== client.client_id) throw new InvalidGrantError('Refresh token was issued to another client');
    const sc = scopes?.length ? scopes.filter((s) => claims.sc.includes(s)) : claims.sc;
    return this.issue({ ...claims, sc });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let claims: GrantClaims & { exp?: number };
    try {
      claims = await this.signer.verify<GrantClaims>('access', token);
    } catch {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    return {
      token,
      clientId: claims.cid,
      scopes: claims.sc,
      expiresAt: claims.exp,
      resource: claims.rs ? new URL(claims.rs) : undefined,
      extra: { userId: claims.sub, userName: claims.name, email: claims.email },
    };
  }

  private async issue(g: GrantClaims): Promise<OAuthTokens> {
    const grant = { sub: g.sub, name: g.name, email: g.email, cid: g.cid, sc: g.sc, rs: g.rs };
    return {
      access_token: await this.signer.sign('access', grant, ACCESS_TTL),
      token_type: 'Bearer',
      expires_in: ACCESS_TTL,
      refresh_token: await this.signer.sign('refresh', grant, REFRESH_TTL),
      scope: g.sc.join(' '),
    };
  }

  private forgetExpiredCodes() {
    const now = Date.now();
    for (const [jti, exp] of this.usedCodes) if (exp < now) this.usedCodes.delete(jti);
  }
}
