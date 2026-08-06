import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * This backend serves many employees of a single customer company from
 * behind one shared office IP - plain IP-based throttling (the library's
 * default) would risk legitimate users at a busy customer locking each
 * other out. Track by the actual credential (apiKey/extensionKey) once a
 * request is authenticated, so each company/employee gets its own budget;
 * only fall back to IP for pre-auth requests (e.g. POST /admin/companies,
 * authenticated via x-admin-username/x-admin-password, not one of the
 * headers below), where IP is the only signal available and is exactly
 * what we want to limit anyway (brute-forcing the operator's credentials).
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req as { headers?: Record<string, unknown> }).headers ?? {};
    const apiKey = headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey) return `apikey:${apiKey}`;
    const extensionKey = headers['x-extension-key'];
    if (typeof extensionKey === 'string' && extensionKey) return `extkey:${extensionKey}`;
    return super.getTracker(req);
  }
}
