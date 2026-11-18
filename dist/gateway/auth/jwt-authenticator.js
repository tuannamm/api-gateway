"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtAuthenticator = void 0;
const jose_1 = require("jose");
const problem_1 = require("../problem");
class JwtAuthenticator {
    issuer;
    audience;
    keys;
    constructor(issuer, audience) {
        this.issuer = issuer;
        this.audience = audience;
        this.keys = (0, jose_1.createRemoteJWKSet)(new URL(`${issuer}/protocol/openid-connect/certs`), { timeoutDuration: 3000, cooldownDuration: 1000 });
    }
    async authenticate(header) {
        if (typeof header !== 'string' || !/^Bearer \S+$/i.test(header))
            throw unauthorized();
        try {
            const { payload } = await (0, jose_1.jwtVerify)(header.slice(7), this.keys, {
                issuer: this.issuer, audience: this.audience, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'],
            });
            if (typeof payload.sub !== 'string' || !payload.sub || payload.typ !== 'Bearer')
                throw unauthorized();
            return { sub: payload.sub, iss: payload.iss };
        }
        catch {
            throw unauthorized();
        }
    }
}
exports.JwtAuthenticator = JwtAuthenticator;
function unauthorized() { return new problem_1.GatewayError(401, 'UNAUTHORIZED', 'A valid bearer access token is required', { 'www-authenticate': 'Bearer' }); }
//# sourceMappingURL=jwt-authenticator.js.map