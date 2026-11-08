import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { GatewayUser } from '../contracts';
import { GatewayError } from '../problem';
export interface Authenticator { authenticate(header: string | string[] | undefined): Promise<GatewayUser> }
export class JwtAuthenticator implements Authenticator {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly issuer: string, private readonly audience: string) {
    this.keys = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`), { timeoutDuration: 3000, cooldownDuration: 1000 });
  }
  async authenticate(header: string | string[] | undefined): Promise<GatewayUser> {
    if (typeof header !== 'string' || !/^Bearer \S+$/i.test(header)) throw unauthorized();
    try {
      const { payload } = await jwtVerify(header.slice(7), this.keys, {
        issuer: this.issuer, audience: this.audience, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (typeof payload.sub !== 'string' || !payload.sub || payload.typ !== 'Bearer') throw unauthorized();
      const access = payload.realm_access as { roles?: unknown } | undefined;
      const roles = Array.isArray(access?.roles) ? access.roles.filter((r): r is string => typeof r === 'string') : [];
      return { sub: payload.sub, iss: payload.iss, roles };
    } catch { throw unauthorized(); }
  }
}
function unauthorized() { return new GatewayError(401, 'UNAUTHORIZED', 'A valid bearer access token is required', { 'www-authenticate': 'Bearer' }); }
