import { createHmac } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// Every OAuth artefact this server hands out is a signed JWT, so the server keeps no OAuth state:
// client registrations, the Slack round-trip state, authorization codes, access and refresh tokens.
// `typ` keeps one kind from being replayed as another.

export type TokenType = 'client' | 'flow' | 'code' | 'access' | 'refresh';

export class TokenSigner {
  constructor(
    private readonly key: Uint8Array,
    private readonly issuer: string,
  ) {}

  async sign(typ: TokenType, claims: JWTPayload, ttlSeconds?: number): Promise<string> {
    let jwt = new SignJWT({ ...claims, typ })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(this.issuer)
      .setIssuedAt();
    if (ttlSeconds) jwt = jwt.setExpirationTime(`${ttlSeconds}s`);
    return jwt.sign(this.key);
  }

  /** Throws if the signature, issuer, expiry or type is wrong. */
  async verify<T extends object>(typ: TokenType, token: string): Promise<T & JWTPayload> {
    const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer, algorithms: ['HS256'] });
    if (payload.typ !== typ) throw new Error(`expected a ${typ} token`);
    return payload as T & JWTPayload;
  }

  /** Deterministic secret for a confidential client, so nothing has to be stored. */
  clientSecret(clientId: string): string {
    return createHmac('sha256', this.key).update(`client-secret:${clientId}`).digest('base64url');
  }
}
