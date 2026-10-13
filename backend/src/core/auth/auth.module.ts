import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScopeService } from '../../shared/security/scope.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { StaffRegistrationService } from './staff-registration.service';
import { PrincipalResolver } from './principal.resolver';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { DbContextService } from './db-context.service';
import { AuthController } from './auth.controller';
import { AccountController } from './account.controller';
import { PasswordChangeService } from './password-change.service';

/**
 * AuthModule — Sprint 1 Task 2 + S10 T1. Authentication + runtime authorization.
 * @Global() so DbContextService (RLS context) is available to every module
 * without explicit imports (S8/S9 architecture: many modules + workers need it).
 *
 * S10-05: ThrottlerModule + AuthThrottlerGuard (APP_GUARD) — rate limits ONLY
 * the pre-auth endpoints that opt in via @Throttle({ auth: {...} }). The
 * module-level default limit is intentionally high (no-op); the real limits
 * live on the route decorators (login 5/min, refresh 10/min, register 3/min).
 */
@Global()
@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 1000 }]),
  ],
  controllers: [AuthController, AccountController],
  providers: [
    PasswordService,
    TokenService,
    RefreshTokenService,
    StaffRegistrationService,
    PrincipalResolver,
    AuthService,
    PasswordChangeService,
    DbContextService,
    ScopeService,
    { provide: APP_GUARD, useClass: AuthThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, TokenService, RefreshTokenService, StaffRegistrationService, PrincipalResolver, DbContextService, PasswordService],
})
export class AuthModule {}
