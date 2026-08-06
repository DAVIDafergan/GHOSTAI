import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Gates operator-only endpoints (creating a new tenant company, listing/
 * disabling any company) behind a single operator account's credentials -
 * known only to the Nistar operator, not tenant admins. Both headers are
 * always compared (never short-circuited on a wrong username before
 * checking the password) so a timing difference can't reveal which one was
 * wrong.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedUsername = request.headers['x-admin-username'];
    const providedPassword = request.headers['x-admin-password'];
    const expectedUsername = process.env.SUPER_ADMIN_USERNAME;
    const expectedPassword = process.env.SUPER_ADMIN_PASSWORD;

    const usernameOk =
      typeof providedUsername === 'string' && !!expectedUsername && safeCompare(providedUsername, expectedUsername);
    const passwordOk =
      typeof providedPassword === 'string' && !!expectedPassword && safeCompare(providedPassword, expectedPassword);

    if (!usernameOk || !passwordOk) {
      throw new UnauthorizedException('Invalid super admin credentials');
    }
    return true;
  }
}
