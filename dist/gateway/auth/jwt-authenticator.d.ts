import type { GatewayUser } from '../contracts';
export interface Authenticator {
    authenticate(header: string | string[] | undefined): Promise<GatewayUser>;
}
export declare class JwtAuthenticator implements Authenticator {
    private readonly issuer;
    private readonly audience;
    private readonly keys;
    constructor(issuer: string, audience: string);
    authenticate(header: string | string[] | undefined): Promise<GatewayUser>;
}
