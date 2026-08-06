import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Gates operator-only endpoints (creating a new tenant company) behind a
 * shared secret known only to the Nistar operator, not tenant admins.
 */
@Injectable()
export class AdminBootstrapGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-admin-secret'];
    const expected = process.env.ADMIN_BOOTSTRAP_SECRET;
    if (!expected || typeof provided !== 'string' || !safeCompare(provided, expected)) {
      throw new UnauthorizedException('Invalid admin bootstrap secret');
    }
    return true;
  }
}
