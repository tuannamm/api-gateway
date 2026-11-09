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
      // Chủ ý KHÔNG đọc realm_access.roles: role/permission nằm ở w-identity, không tin claim trong token.
      return { sub: payload.sub, iss: payload.iss };
    } catch { throw unauthorized(); }
  }
}
function unauthorized() { return new GatewayError(401, 'UNAUTHORIZED', 'A valid bearer access token is required', { 'www-authenticate': 'Bearer' }); }
