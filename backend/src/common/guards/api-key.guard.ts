import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashSecret } from '../crypto/hashing.util';

/**
 * Authenticates a request as acting on behalf of a Company, via the
 * company's apiKey (used by the Connector, and for now by company-admin
 * CRUD operations until a dedicated admin-console login exists).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Missing x-api-key header');
    }
    const company = await this.prisma.company.findUnique({
      where: { apiKeyHash: hashSecret(apiKey) },
    });
    if (!company || company.deletedAt) {
      throw new UnauthorizedException('Invalid API key');
    }
    request.company = company;
    return true;
  }
}
