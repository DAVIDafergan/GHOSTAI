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

  /**
   * Operator-only, system-wide view for the super-admin dashboard: pure
   * operational metadata (counts, statuses) aggregated per company - never
   * any customer's actual sensitive entity values, which this service
   * never has access to in the first place (see SECURITY.md).
   */
  async listAllWithStats() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [companies, employeeCounts, blockCounts, connectors, healthChecks] = await Promise.all([
      this.prisma.company.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.employee.groupBy({ by: ['companyId'], _count: { _all: true } }),
      this.prisma.auditLog.groupBy({
        by: ['companyId'],
        where: { eventType: 'blocked', createdAt: { gte: monthStart } },
        _count: { _all: true },
      }),
      this.prisma.connector.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.healthCheck.findMany({ orderBy: { ranAt: 'desc' } }),
    ]);

    const employeeCountByCompany = new Map(employeeCounts.map((e) => [e.companyId, e._count._all]));
    const blocksByCompany = new Map(blockCounts.map((b) => [b.companyId, b._count._all]));
    // First connector/health-check encountered per company, in
    // desc-createdAt/ranAt order, is the most recent one - cheaper than a
    // per-company query given the expected scale (an operator's whole
    // customer base, not millions of rows), and avoids a raw-SQL window
    // function for a "latest per group" that Prisma doesn't support
    // natively.
    const latestConnectorByCompany = new Map<string, (typeof connectors)[number]>();
    for (const connector of connectors) {
      if (!latestConnectorByCompany.has(connector.companyId)) {
        latestConnectorByCompany.set(connector.companyId, connector);
      }
    }
    const latestHealthCheckByCompany = new Map<string, (typeof healthChecks)[number]>();
    for (const check of healthChecks) {
      if (!latestHealthCheckByCompany.has(check.companyId)) {
        latestHealthCheckByCompany.set(check.companyId, check);
      }
    }

    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      adminEmail: c.adminEmail,
      status: c.status,
      createdAt: c.createdAt,
      employeeCount: employeeCountByCompany.get(c.id) ?? 0,
      blocksThisMonth: blocksByCompany.get(c.id) ?? 0,
      connectorStatus: latestConnectorByCompany.get(c.id)?.status ?? 'none',
      connectorLastSyncAt: latestConnectorByCompany.get(c.id)?.lastSyncAt ?? null,
      healthCheckSuccess: latestHealthCheckByCompany.get(c.id)?.success ?? null,
      healthCheckAt: latestHealthCheckByCompany.get(c.id)?.ranAt ?? null,
    }));
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

  updateSettings(
    companyId: string,
    settings: { confidenceThreshold?: number; enabledEntityTypes?: string[]; connectorAdminUrl?: string },
  ) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: settings,
    });
  }
}
