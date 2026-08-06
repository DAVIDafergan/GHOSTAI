import { Injectable, NotFoundException } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConnectorsService {
  constructor(private readonly prisma: PrismaService) {}

  create(company: Company, sourceType: string) {
    return this.prisma.connector.create({
      data: { companyId: company.id, sourceType },
    });
  }

  list(companyId: string) {
    return this.prisma.connector.findMany({ where: { companyId } });
  }

  async getOwned(company: Company, id: string) {
    const connector = await this.prisma.connector.findFirst({
      where: { id, companyId: company.id },
    });
    if (!connector) {
      throw new NotFoundException('Connector not found');
    }
    return connector;
  }

  async startSync(company: Company, id: string) {
    await this.getOwned(company, id);
    return this.prisma.connector.update({
      where: { id },
      data: { status: 'syncing', syncStartedAt: new Date() },
    });
  }

  /**
   * Called once a full sync run completes successfully. Prunes entities
   * belonging to this connector that were not re-affirmed (seenAt) during
   * this run - e.g. customers deleted or renamed at the source since the
   * last sync - without touching entities from other connectors.
   */
  async completeSync(company: Company, id: string) {
    const connector = await this.getOwned(company, id);
    if (connector.syncStartedAt) {
      await this.prisma.sensitiveEntity.deleteMany({
        where: {
          companyId: company.id,
          connectorId: id,
          seenAt: { lt: connector.syncStartedAt },
        },
      });
    }
    return this.prisma.connector.update({
      where: { id },
      data: { status: 'connected', lastSyncAt: new Date(), syncStartedAt: null },
    });
  }

  /**
   * Called when a sync run fails/drops partway through, so the backend
   * never silently treats a partial batch as a complete, trustworthy sync.
   */
  async failSync(company: Company, id: string) {
    await this.getOwned(company, id);
    return this.prisma.connector.update({
      where: { id },
      data: { status: 'sync_incomplete' },
    });
  }

  /**
   * Removes a stale/duplicate connector record (e.g. one created by a
   * daemon restart that predates a persisted connectorId). Entities are
   * never deleted here - only unlinked from this connector - since a
   * connector row is just sync-run metadata, not the source of truth for
   * whether an entity is still known-sensitive.
   */
  async delete(company: Company, id: string) {
    await this.getOwned(company, id);
    await this.prisma.sensitiveEntity.updateMany({
      where: { companyId: company.id, connectorId: id },
      data: { connectorId: null },
    });
    await this.prisma.connector.delete({ where: { id } });
    return { deleted: true };
  }
}
