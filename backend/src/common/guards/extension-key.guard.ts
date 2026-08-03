import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashSecret } from '../crypto/hashing.util';

/**
 * Authenticates a request as coming from a specific Employee's browser
 * extension install, via the per-employee extensionKey.
 */
@Injectable()
export class ExtensionKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-extension-key'];
    if (!key || typeof key !== 'string') {
      throw new UnauthorizedException('Missing x-extension-key header');
    }
    const employee = await this.prisma.employee.findUnique({
      where: { extensionKeyHash: hashSecret(key) },
    });
    if (!employee || employee.disabledAt) {
      throw new UnauthorizedException('Invalid or disabled extension key');
    }
    await this.prisma.employee.update({
      where: { id: employee.id },
      data: { lastActiveAt: new Date(), activatedAt: employee.activatedAt ?? new Date() },
    });
    request.employee = employee;
    return true;
  }
}
