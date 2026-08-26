import {
  Injectable, CanActivate, ExecutionContext, Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TokenService } from './token.service';
import { PrincipalResolver } from './principal.resolver';
import { Principal } from './principal';
import { IS_PUBLIC_KEY } from './decorators';
import { UnauthorizedError } from '../../shared/errors/errors';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';

/** Express request augmented with the resolved Principal. */
export interface AuthedRequest extends Request {
  principal?: Principal;
}

/**
 * AuthGuard — global authentication gate (Part 4).
 *
 *   no token      → 401
 *   invalid token → 401
 *   expired token → 401
 *   valid token   → Principal created (derived from DB, fail-closed)
 *
 * Routes marked @Public() (health, login) skip this guard. Everything else
 * requires a valid Bearer token AND a resolvable Principal.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalResolver,
    @Inject(DATABASE) private readonly db: Database | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'] ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedError('Authentication required'); /* no token */
    }

    /* verifyAccess throws 401 on malformed/expired/wrong-signature. */
    const claims = this.tokens.verifyAccess(token);

    /* Derive Principal from DB — fail-closed when not resolvable. */
    const principal = await this.principals.resolve(claims.sub, claims.orgId);
    if (!principal) throw new UnauthorizedError('Authentication required');

    req.principal = principal;
    return true;
  }
}
