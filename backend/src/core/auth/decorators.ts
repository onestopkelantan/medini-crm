import { SetMetadata } from '@nestjs/common';

/** Marks a route/controller as public (skips the global AuthGuard). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Declares the permission a route requires: can(role, domain, action). */
export const PERMISSION_KEY = 'requiredPermission';
export interface RequiredPermission {
  domain: string;
  action: string;
}
export const RequirePermission = (domain: string, action: string) =>
  SetMetadata(PERMISSION_KEY, { domain, action } as RequiredPermission);
