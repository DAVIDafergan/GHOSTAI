import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateSecret, hashSecret } from '../common/crypto/hashing.util';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string, adminEmail?: string) {
    const apiKey = generateSecret();
    const company = await this.prisma.company.create({
      data: {
        name,
        adminEmail,
        apiKeyHash: hashSecret(apiKey),
      },
    });
    // apiKey is returned exactly once at creation time; only its hash is persisted.
    return { company, apiKey };
  }

  async findById(id: string) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async softDelete(id: string) {
    await this.findById(id);
    return this.prisma.company.update({
      where: { id },
      data: { status: 'pending_deletion', deletedAt: new Date() },
    });
  }

  updateSettings(companyId: string, settings: { confidenceThreshold?: number; enabledEntityTypes?: string[] }) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: settings,
    });
  }
}
