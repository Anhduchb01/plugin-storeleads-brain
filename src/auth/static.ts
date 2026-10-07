import { readFileSync, statSync } from 'node:fs';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { SCOPE } from './slack.js';

// AUTH_MODE=token: personal bearer tokens handed out by an admin (deploy/new-token.sh), until Slack sign-in is
// set up. Works from Claude Code (the token goes in a header); claude.ai connectors need OAuth (AUTH_MODE=slack).
//
// Sources: ACCESS_TOKENS="token:user,…" and/or TOKENS_FILE with one "token user_id [display name]" per line
// (# comments allowed). The file is re-read when it changes, so adding a person needs no restart.

interface Entry {
  userId: string;
  userName: string;
}

export function parseTokens(inline: string, fileText: string): Map<string, Entry> {
  const tokens = new Map<string, Entry>();
  for (const pair of inline.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [token, user] = pair.split(':');
    if (token && user) tokens.set(token, { userId: user, userName: user });
  }
  for (const line of fileText.split('\n')) {
    const [token, user, ...name] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (token && user) tokens.set(token, { userId: user, userName: name.join(' ') || user });
  }
  return tokens;
}

export class StaticTokenVerifier {
  private tokens = new Map<string, Entry>();
  private fileMtime = -1;
  private lastCheck = 0;

  constructor(
    private readonly opts: { inline: string; file: string; minLength: number },
    private readonly log: (msg: string) => void = () => undefined,
  ) {
    this.reload(true);
  }

  private reload(force = false) {
    const now = Date.now();
    if (!force && now - this.lastCheck < 5_000) return;
    this.lastCheck = now;
    let text = '';
    if (this.opts.file) {
      const mtime = statSync(this.opts.file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
      if (!force && mtime === this.fileMtime) return;
      this.fileMtime = mtime;
      text = mtime ? readFileSync(this.opts.file, 'utf8') : '';
    }
    const parsed = parseTokens(this.opts.inline, text);
    for (const token of parsed.keys()) {
      if (token.length < this.opts.minLength) {
        parsed.delete(token);
        this.log(`ignoring a token shorter than ${this.opts.minLength} characters`);
      }
    }
    this.tokens = parsed;
    this.log(`token mode: ${parsed.size} token(s) loaded`);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.reload();
    const entry = this.tokens.get(token);
    if (!entry) throw new InvalidTokenError('Unknown token');
    // The bearer middleware requires an expiry; a static token is good for a day from each use.
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    return { token, clientId: 'token', scopes: [SCOPE], expiresAt, extra: { userId: entry.userId, userName: entry.userName, email: '' } };
  }
}
